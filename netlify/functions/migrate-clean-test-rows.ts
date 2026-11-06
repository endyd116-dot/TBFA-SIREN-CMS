/**
 * GET /api/migrate-clean-test-rows        — 진단 (인증 불필요·건수만)
 * GET /api/migrate-clean-test-rows?run=1  — 실행 (어드민 인증)
 *
 * 지출·수입 기록에 남은 시험 입력 4건을 지운다(Swain 확인 2026-11-06).
 * [점검] 지출 2건, 5월 15일 지출 123,232원, 5월 15일 수입 1,100,000원.
 * 멱등: 다시 실행해도 안전. 호출 성공 후 파일 삭제 + commit (CLAUDE.md §6.8).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { ledgerActor, recordHistory } from "../../lib/ledger-post";

export const config = { path: "/api/migrate-clean-test-rows" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

const EXPENSES = sql`((description LIKE '[점검]%' AND status = 'canceled')
  OR (id = 1 AND amount = 123232 AND payee_name = '12323'))`;
const REVENUES = sql`(id = 1 AND amount = 1100000 AND payer_name = '기업')`;

async function count(exec: { execute: (q: any) => Promise<any> }) {
  const n = async (q: any) => Number(rowsOf(await exec.execute(q))[0]?.n ?? 0);
  return {
    expenses: await n(sql`SELECT COUNT(*)::int AS n FROM expenses WHERE ${EXPENSES}`),
    revenues: await n(sql`SELECT COUNT(*)::int AS n FROM other_revenues WHERE ${REVENUES}`),
    linkedVouchers: await n(sql`SELECT COUNT(*)::int AS n FROM vouchers
      WHERE expense_id IN (SELECT id FROM expenses WHERE ${EXPENSES})`),
  };
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const run = new URL(req.url).searchParams.get("run") === "1";
    step = "diag";
    const before = await count(db);
    if (!run) {
      return new Response(jsonKST({ ok: true, mode: "diagnose", ...before, hint: "?run=1 로 실행하세요." }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;

    step = "run";
    if (before.linkedVouchers > 0) {
      return new Response(jsonKST({ ok: false, error: "전표가 연결된 행이 있어 지우지 않았습니다", step, ...before }, null, 2), { status: 409, headers: JSON_HEADER });
    }
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM expenses WHERE ${EXPENSES}`);
      await tx.execute(sql`DELETE FROM other_revenues WHERE ${REVENUES}`);
      await recordHistory(tx, { entity: "cleanup", entityId: "2026-11-06", action: "test_rows_removed", actor: ledgerActor(auth), after: before });
      return before;
    });
    return new Response(jsonKST({ ok: true, mode: "run", deletedExpenses: result.expenses, deletedRevenues: result.revenues }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "시험 입력 삭제 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
