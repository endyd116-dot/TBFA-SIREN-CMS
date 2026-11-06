/**
 * GET  /api/admin-ledger-public?year=2026            공익법인 대응 자료
 * GET  /api/admin-ledger-public?year=2026&doc=vouchers  세무사 전달용 분개 목록
 * POST /api/admin-ledger-public
 *   { action:'disclosure_save', year, title, intro }  재정 공개 문구
 *   { action:'publish', year } / { action:'unpublish', year }  공개·내리기 (이사장)
 *   { action:'target_save', target }                  사업수행 비율 기준 (이사장)
 *   { action:'designate', designatedOn }              공익법인 지정일. 영수증 서식이 이 날부터 바뀐다 (이사장)
 *
 * 공개 자료는 공개 순간의 숫자로 고정한다. 장부가 바뀌면 다시 공개한다.
 */
import { jsonKST, todayKST, yearKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { sql } from "drizzle-orm";
import { LedgerError, ledgerActor, ledgerErrorBody, recordHistory } from "../../lib/ledger-post";
import { disclosureData, publicBenefitData, voucherExport } from "../../lib/ledger-public";

export const config = { path: "/api/admin-ledger-public" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(jsonKST(body), { status, headers: JSON_HEADERS });

async function designatedOn(): Promise<string | null> {
  const r = rowsOf(await db.execute(sql`SELECT designated_on FROM receipt_settings WHERE id = 1`))[0];
  return r?.designated_on ? String(r.designated_on).slice(0, 10) : null;
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const role = String(auth.ctx.member.role ?? "");
  const actor = ledgerActor(auth);

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const year = Number(url.searchParams.get("year")) || yearKST();
      if (url.searchParams.get("doc") === "vouchers") {
        const rows = await voucherExport(year);
        if (!rows) return json({ ok: false, error: `${year}년 회계연도가 없습니다` }, 404);
        return json({ ok: true, data: { rows } });
      }
      const data = await publicBenefitData(year);
      if (!data) return json({ ok: false, error: `${year}년 회계연도가 없습니다` }, 404);
      return json({ ok: true, data: { ...data, designatedOn: await designatedOn() } });
    }
    if (req.method !== "POST") return json({ ok: false, error: "GET, POST만 허용" }, 405);

    let body: any;
    try { body = await req.json(); } catch { body = {}; }
    const action = String(body?.action ?? "");
    const year = Number(body?.year) || 0;

    if (action === "disclosure_save") {
      if (!(await canAccess(role, "finance_ledger_manage"))) return json({ ok: false, error: "이 기능에 대한 접근 권한이 없습니다" }, 403);
      if (!year) throw new LedgerError("year 필수", 400);
      const title = String(body?.title ?? "").trim().slice(0, 200) || `${year}년 재정 공개`;
      const intro = String(body?.intro ?? "").trim().slice(0, 3000);
      await db.execute(sql`
        INSERT INTO ledger_disclosures (year, title, intro, updated_at) VALUES (${year}, ${title}, ${intro}, NOW())
        ON CONFLICT (year) DO UPDATE SET title = EXCLUDED.title, intro = EXCLUDED.intro, updated_at = NOW()`);
      return json({ ok: true, data: { year } });
    }

    if (role !== "super_admin") return json({ ok: false, error: "이 처리는 이사장만 할 수 있습니다" }, 403);

    if (action === "publish") {
      if (!year) throw new LedgerError("year 필수", 400);
      const pack = await publicBenefitData(year);
      if (!pack) throw new LedgerError(`${year}년 회계연도가 없습니다`, 404);
      const on = await designatedOn();
      const data = disclosureData(pack, !!on && on <= todayKST());
      const title = pack.disclosure?.title ?? `${year}년 재정 공개`;
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO ledger_disclosures (year, title, intro, status, data, published_at, published_by_name, updated_at)
          VALUES (${year}, ${title}, ${pack.disclosure?.intro ?? ""}, 'published', ${JSON.stringify(data)}::jsonb, NOW(), ${actor.name}, NOW())
          ON CONFLICT (year) DO UPDATE SET status = 'published', data = EXCLUDED.data,
            published_at = NOW(), published_by_name = EXCLUDED.published_by_name, updated_at = NOW()`);
        await tx.execute(sql`UPDATE nav_menu_items SET is_active = TRUE, updated_at = NOW() WHERE href = '/transparency.html'`);
        await recordHistory(tx, { entity: "disclosure", entityId: year, action: "published", actor, after: { incomeTotal: data.incomeTotal, spendingTotal: data.spendingTotal } });
      });
      return json({ ok: true, data: { status: "published" } });
    }

    if (action === "unpublish") {
      if (!year) throw new LedgerError("year 필수", 400);
      await db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE ledger_disclosures SET status = 'draft', updated_at = NOW() WHERE year = ${year}`);
        await recordHistory(tx, { entity: "disclosure", entityId: year, action: "unpublished", actor });
      });
      return json({ ok: true, data: { status: "draft" } });
    }

    if (action === "target_save") {
      const target = Number(body?.target);
      if (!Number.isFinite(target) || target < 0 || target > 100) throw new LedgerError("0에서 100 사이로 입력하세요", 400);
      await db.execute(sql`UPDATE approval_settings SET public_ratio_target = ${Math.round(target)}, updated_at = NOW() WHERE id = 1`);
      return json({ ok: true, data: { target } });
    }

    if (action === "designate") {
      const on = String(body?.designatedOn ?? "");
      const value = /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : null;
      await db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE receipt_settings SET designated_on = ${value} WHERE id = 1`);
        await recordHistory(tx, { entity: "disclosure", entityId: 0, action: "designated", actor, after: { designatedOn: value } });
      });
      return json({ ok: true, data: { designatedOn: value } });
    }

    return json({ ok: false, error: "알 수 없는 처리입니다" }, 400);
  } catch (err: any) {
    const { status, body } = ledgerErrorBody("public", "공익법인 자료 처리 실패", err);
    return json(body, status);
  }
}
