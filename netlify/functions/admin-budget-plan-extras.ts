/**
 * GET  /api/admin-budget-plan-extras?planId=1
 *      수입 예산, 목별 사업·활동·재원 나누기, 전기이월, 수지 합계
 * POST /api/admin-budget-plan-extras
 *   { action:'revenue', planId, lines:[{ accountCode, fundId?, plannedAmount, note? }] }
 *   { action:'splits', planId, lineId, splits:[{ functionCode?, programId?, fundId?, amount, note? }] }
 *   { action:'carry', planId, carryIn }
 *
 * 수입 과목은 수익 계정을 쓴다. 예산 과목(관·항·목)은 지출 전용이라 건드리지 않는다.
 * 나누기는 목 한 줄 아래 하위 표다. 목 합계와 같아야 저장된다.
 * 작성중·반려 예산안만 고칠 수 있다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { sql } from "drizzle-orm";
import { LedgerError, ledgerErrorBody } from "../../lib/ledger-post";
import { loadFiscalYears } from "../../lib/ledger-report";
import { budgetStatement } from "../../lib/ledger-statements";

export const config = { path: "/api/admin-budget-plan-extras" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(jsonKST(body), { status, headers: JSON_HEADERS });
const amountOf = (v: unknown): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const FUNCTIONS = ["service", "admin", "fundraising"];

async function loadExtras(planId: number) {
  const plan = rowsOf(await db.execute(sql`
    SELECT id, fiscal_year, status, title, carry_in, total_planned FROM budget_plans WHERE id = ${planId}`))[0];
  if (!plan) return null;
  const year = Number(plan.fiscal_year);

  const revenueLines = rowsOf(await db.execute(sql`
    SELECT b.id, b.account_code, b.fund_id, b.planned_amount, b.prev_year_actual, b.note, a.name
      FROM budget_revenue_lines b JOIN account_codes a ON a.code = b.account_code
     WHERE b.plan_id = ${planId} ORDER BY b.account_code`)).map((r: any) => ({
    id: Number(r.id), accountCode: r.account_code, accountName: r.name, fundId: r.fund_id == null ? null : Number(r.fund_id),
    plannedAmount: Number(r.planned_amount) || 0, prevYearActual: Number(r.prev_year_actual) || 0, note: r.note,
  }));

  const splits = rowsOf(await db.execute(sql`
    SELECT s.id, s.line_id, s.function_code, s.program_id, s.fund_id, s.amount, s.note
      FROM budget_line_splits s JOIN budget_lines l ON l.id = s.line_id
     WHERE l.plan_id = ${planId} ORDER BY s.line_id, s.id`)).map((r: any) => ({
    id: Number(r.id), lineId: Number(r.line_id), functionCode: r.function_code,
    programId: r.program_id == null ? null : Number(r.program_id), fundId: r.fund_id == null ? null : Number(r.fund_id),
    amount: Number(r.amount) || 0, note: r.note,
  }));

  /* 전년 실적과 전기이월 제안값. 전년 장부가 없으면 비어 있다 */
  const prev = (await loadFiscalYears()).find((f) => f.year === year - 1);
  const prevRevenue: { accountCode: string; amount: number }[] = [];
  let cashAtPrevEnd = 0;
  if (prev) {
    for (const r of rowsOf(await db.execute(sql`
      SELECT l.account_code, COALESCE(SUM(l.credit - l.debit), 0)::bigint AS amount
        FROM voucher_lines l
        JOIN vouchers v ON v.id = l.voucher_id
        JOIN account_codes a ON a.code = l.account_code
       WHERE v.status = 'approved' AND v.is_template = FALSE AND a.kind = 'revenue'
         AND v.voucher_date BETWEEN ${prev.startDate} AND ${prev.endDate}
       GROUP BY l.account_code`))) prevRevenue.push({ accountCode: r.account_code, amount: Number(r.amount) || 0 });
    const cash = rowsOf(await db.execute(sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint AS balance
        FROM voucher_lines l
        JOIN vouchers v ON v.id = l.voucher_id
        JOIN account_codes a ON a.code = l.account_code
       WHERE v.status = 'approved' AND v.is_template = FALSE AND a.parent_code = '101'
         AND v.voucher_date <= ${prev.endDate}`))[0];
    cashAtPrevEnd = Number(cash?.balance) || 0;
  }

  return {
    plan: {
      id: Number(plan.id), fiscalYear: year, status: plan.status, title: plan.title,
      carryIn: Number(plan.carry_in) || 0, totalPlanned: Number(plan.total_planned) || 0,
    },
    revenueLines, splits, prevRevenue, cashAtPrevEnd,
    statement: await budgetStatement(year),
  };
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  if (req.method === "GET") {
    const planId = Number(new URL(req.url).searchParams.get("planId")) || 0;
    if (!planId) return json({ ok: false, error: "planId 필수" }, 400);
    try {
      const data = await loadExtras(planId);
      if (!data) return json({ ok: false, error: "예산안을 찾을 수 없습니다" }, 404);
      return json({ ok: true, data });
    } catch (err: any) {
      return json({
        ok: false, error: "예산 부가 정보 조회 실패", step: "select",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }, 500);
    }
  }
  if (req.method !== "POST") return json({ ok: false, error: "GET, POST만 허용" }, 405);
  if (!(await canAccess(String(auth.ctx.member.role ?? ""), "finance_bookkeeping"))) {
    return json({ ok: false, error: "이 기능에 대한 접근 권한이 없습니다" }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const action = String(body?.action ?? "");
  const planId = Number(body?.planId) || 0;
  if (!planId) return json({ ok: false, error: "planId 필수" }, 400);

  try {
    await db.transaction(async (tx) => {
      const plan = rowsOf(await tx.execute(sql`SELECT id, status FROM budget_plans WHERE id = ${planId} FOR UPDATE`))[0];
      if (!plan) throw new LedgerError("예산안을 찾을 수 없습니다", 404);
      if (plan.status !== "draft" && plan.status !== "rejected") {
        throw new LedgerError("작성중이거나 반려된 예산안만 고칠 수 있습니다.");
      }

      if (action === "carry") {
        const carryIn = Math.trunc(Number(body?.carryIn));
        if (!Number.isFinite(carryIn)) throw new LedgerError("전기이월금을 숫자로 입력하세요", 400);
        await tx.execute(sql`UPDATE budget_plans SET carry_in = ${carryIn}, updated_at = NOW() WHERE id = ${planId}`);
        return;
      }

      if (action === "revenue") {
        const lines = Array.isArray(body?.lines) ? body.lines : [];
        const seen = new Set<string>();
        for (const l of lines) {
          const code = String(l?.accountCode ?? "");
          if (seen.has(code)) throw new LedgerError(`같은 수입 과목이 두 번 있습니다: ${code}`, 400);
          seen.add(code);
          const account = rowsOf(await tx.execute(sql`SELECT kind FROM account_codes WHERE code = ${code}`))[0];
          if (account?.kind !== "revenue") throw new LedgerError(`수익 계정이 아닙니다: ${code}`, 400);
        }
        await tx.execute(sql`DELETE FROM budget_revenue_lines WHERE plan_id = ${planId}`);
        for (const l of lines) {
          await tx.execute(sql`
            INSERT INTO budget_revenue_lines (plan_id, account_code, fund_id, planned_amount, prev_year_actual, note)
            VALUES (${planId}, ${String(l.accountCode)}, ${Number(l?.fundId) || null}, ${amountOf(l?.plannedAmount)},
                    ${amountOf(l?.prevYearActual)}, ${String(l?.note ?? "").trim().slice(0, 500) || null})`);
        }
        return;
      }

      if (action === "splits") {
        const lineId = Number(body?.lineId) || 0;
        const line = rowsOf(await tx.execute(sql`
          SELECT id, planned_amount FROM budget_lines WHERE id = ${lineId} AND plan_id = ${planId}`))[0];
        if (!line) throw new LedgerError("예산 줄을 찾을 수 없습니다", 404);
        const splits = (Array.isArray(body?.splits) ? body.splits : []).filter((s: any) => amountOf(s?.amount) > 0);
        const sum = splits.reduce((t: number, s: any) => t + amountOf(s.amount), 0);
        if (splits.length && sum !== Number(line.planned_amount)) {
          throw new LedgerError(`나눈 금액의 합이 편성액과 다릅니다. 합계 ${sum.toLocaleString("ko-KR")}원, 편성액 ${Number(line.planned_amount).toLocaleString("ko-KR")}원`);
        }
        for (const s of splits) {
          const fn = s?.functionCode ? String(s.functionCode) : null;
          if (fn && !FUNCTIONS.includes(fn)) throw new LedgerError("활동 값이 올바르지 않습니다", 400);
          if (fn === "service" && !Number(s?.programId)) throw new LedgerError("사업수행은 사업을 골라야 합니다", 400);
        }
        await tx.execute(sql`DELETE FROM budget_line_splits WHERE line_id = ${lineId}`);
        for (const s of splits) {
          const fn = s?.functionCode ? String(s.functionCode) : null;
          await tx.execute(sql`
            INSERT INTO budget_line_splits (line_id, function_code, program_id, fund_id, amount, note)
            VALUES (${lineId}, ${fn}, ${fn === "service" ? Number(s.programId) : null}, ${Number(s?.fundId) || null},
                    ${amountOf(s.amount)}, ${String(s?.note ?? "").trim().slice(0, 200) || null})`);
        }
        return;
      }

      throw new LedgerError("알 수 없는 처리입니다", 400);
    });
    return json({ ok: true, data: await loadExtras(planId) });
  } catch (err: any) {
    const { status, body: payload } = ledgerErrorBody(action || "save", "예산 저장 실패", err);
    return json(payload, status);
  }
}
