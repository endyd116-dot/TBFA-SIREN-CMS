/**
 * GET  /api/admin-ledger-fiscal-year        회계연도 목록
 * POST /api/admin-ledger-fiscal-year        { year, startDate, endDate, note?, reason? } 추가·변경 (이사장)
 *
 * 장부 시작일을 바꿔도 승인 전표가 기간 밖으로 나가면 거절한다.
 * 회계연도는 정관 제32조에 따라 달력 연도 안에서만 정한다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { LedgerError, ledgerActor, ledgerErrorBody, recordHistory, ymd } from "../../lib/ledger-post";
import { loadFiscalYears } from "../../lib/ledger-report";

export const config = { path: "/api/admin-ledger-fiscal-year" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const JSON_HEADERS = { "Content-Type": "application/json" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  if (req.method === "GET") {
    try {
      return new Response(jsonKST({ ok: true, data: { fiscalYears: await loadFiscalYears() } }),
        { status: 200, headers: JSON_HEADERS });
    } catch (err: any) {
      return new Response(jsonKST({
        ok: false, error: "회계연도 조회 실패", step: "select",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }), { status: 500, headers: JSON_HEADERS });
    }
  }

  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "GET, POST만 허용" }), { status: 405, headers: JSON_HEADERS });
  }
  if (auth.ctx.member.role !== "super_admin") {
    return new Response(jsonKST({ ok: false, error: "회계연도 변경은 이사장만 할 수 있습니다" }), { status: 403, headers: JSON_HEADERS });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const year = Number(body?.year);
  const startDate = String(body?.startDate ?? "");
  const endDate = String(body?.endDate ?? "");
  const note = body?.note !== undefined ? String(body.note).slice(0, 500) : undefined;
  const reason = String(body?.reason ?? "").trim().slice(0, 300) || null;

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return new Response(jsonKST({ ok: false, error: "연도를 확인하세요" }), { status: 400, headers: JSON_HEADERS });
  }
  if (!DATE.test(startDate) || !DATE.test(endDate) || startDate > endDate) {
    return new Response(jsonKST({ ok: false, error: "시작일과 종료일을 확인하세요" }), { status: 400, headers: JSON_HEADERS });
  }
  if (!startDate.startsWith(`${year}-`) || !endDate.startsWith(`${year}-`)) {
    return new Response(jsonKST({ ok: false, error: "시작일과 종료일은 같은 연도 안이어야 합니다" }), { status: 400, headers: JSON_HEADERS });
  }

  const actor = ledgerActor(auth);
  try {
    await db.transaction(async (tx) => {
      const cur = rowsOf(await tx.execute(sql`SELECT * FROM ledger_fiscal_years WHERE year = ${year} FOR UPDATE`))[0];
      if (cur?.status === "closed") throw new LedgerError("결산이 끝난 회계연도는 바꿀 수 없습니다.");

      const outside = Number(rowsOf(await tx.execute(sql`
        SELECT COUNT(*)::int AS n FROM vouchers
         WHERE status = 'approved' AND is_template = FALSE AND fiscal_year = ${year}
           AND (voucher_date < ${startDate} OR voucher_date > ${endDate})`))[0]?.n ?? 0);
      if (outside > 0) throw new LedgerError(`승인된 전표 ${outside}건이 새 기간 밖으로 나갑니다.`);

      if (cur) {
        await tx.execute(sql`
          UPDATE ledger_fiscal_years
             SET start_date = ${startDate}, end_date = ${endDate},
                 note = ${note !== undefined ? note : cur.note}, updated_at = NOW()
           WHERE year = ${year}`);
      } else {
        await tx.execute(sql`
          INSERT INTO ledger_fiscal_years (year, start_date, end_date, note)
          VALUES (${year}, ${startDate}, ${endDate}, ${note ?? null})`);
      }
      await recordHistory(tx, {
        entity: "fiscal_year", entityId: year, action: cur ? "updated" : "created", actor, reason,
        before: cur ? { startDate: ymd(cur.start_date), endDate: ymd(cur.end_date) } : undefined,
        after: { startDate, endDate },
      });
    });
    return new Response(jsonKST({ ok: true, data: { fiscalYears: await loadFiscalYears() } }),
      { status: 200, headers: JSON_HEADERS });
  } catch (err: any) {
    const { status, body: payload } = ledgerErrorBody("save", "회계연도 저장 실패", err);
    return new Response(jsonKST(payload), { status, headers: JSON_HEADERS });
  }
}
