/**
 * 회비 규칙 반영 — 캠페인 문구 갱신 (1회용, 2026-11-08. 확인 뒤 파일 삭제)
 *
 * GET /api/migrate-member-fee-terms           진단 (인증 불필요): 고칠 캠페인과 지금 문구를 보여 준다
 * GET /api/migrate-member-fee-terms?run=1     어드민 로그인 뒤 실행
 *
 * 하는 일(캠페인 확장 설정 campaigns.extras, 어드민 «등불 테마·확장 설정»에 저장된 값):
 *   1. 사다리 안내 «최소 1,000원부터 가능합니다» → «최소 10,000원부터 가능합니다» (서버 최소 금액이 1만 원으로 올라감)
 *   2. 회비 안내에 «일시 후원회원은 납부일부터 1년, 정기 후원회원은 매월 납부하는 동안 회원 자격이 유지됩니다.» 한 문장 추가(없을 때만)
 * 멱등: 이미 고친 값이면 건너뛴다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-member-fee-terms" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(jsonKST(body), { status, headers: JSON_HEADERS });

const OLD_MIN = "최소 1,000원부터 가능합니다";
const NEW_MIN = "최소 10,000원부터 가능합니다";
const TERM_LINE = "일시 후원회원은 납부일부터 1년, 정기 후원회원은 매월 납부하는 동안 회원 자격이 유지됩니다.";

async function scan() {
  const rows = rowsOf(await db.execute(sql`
    SELECT id, slug, extras->'ladder'->>'minNote' AS min_note, extras->>'feeNotice' AS fee_notice
      FROM campaigns WHERE extras IS NOT NULL ORDER BY id`));
  return rows.map((r: any) => ({
    id: Number(r.id), slug: r.slug, minNote: r.min_note ?? null, feeNotice: r.fee_notice ?? null,
    fixMin: r.min_note === OLD_MIN,
    fixFee: typeof r.fee_notice === "string" && r.fee_notice.length > 0 && !r.fee_notice.includes("납부일부터 1년"),
  }));
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";
  try {
    const plan = await scan();
    if (!run) {
      return json({ ok: true, mode: "diagnose", note: "?run=1 로 실행합니다(어드민 로그인 필요)", campaigns: plan });
    }
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;

    let minFixed = 0;
    let feeFixed = 0;
    for (const c of plan) {
      if (c.fixMin) {
        await db.execute(sql`
          UPDATE campaigns SET extras = jsonb_set(extras, '{ladder,minNote}', to_jsonb(${NEW_MIN}::text), true), updated_at = NOW()
           WHERE id = ${c.id}`);
        minFixed += 1;
      }
      if (c.fixFee) {
        const next = `${String(c.feeNotice).trim()} ${TERM_LINE}`;
        await db.execute(sql`
          UPDATE campaigns SET extras = jsonb_set(extras, '{feeNotice}', to_jsonb(${next}::text), true), updated_at = NOW()
           WHERE id = ${c.id}`);
        feeFixed += 1;
      }
    }
    return json({ ok: true, mode: "run", minFixed, feeFixed, after: await scan() });
  } catch (err: any) {
    return json({ ok: false, error: "실행 실패", detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 1000) }, 500);
  }
}
