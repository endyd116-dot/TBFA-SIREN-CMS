import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-budget-plan-create" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "예산안 생성 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const adminId = auth.ctx.admin.uid;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { fiscalYear, title } = body;
  if (!fiscalYear || typeof fiscalYear !== "number") {
    return new Response(jsonKST({ ok: false, error: "fiscalYear(숫자) 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const planTitle = title || `${fiscalYear}년도 예산안`;

  // 중복 체크
  try {
    const dup: any = await db.execute(sql`
      SELECT id FROM budget_plans WHERE fiscal_year = ${fiscalYear} LIMIT 1
    `);
    if ((dup?.rows ?? dup ?? []).length > 0) {
      return new Response(jsonKST({ ok: false, error: `${fiscalYear}년도 예산안이 이미 존재합니다` }),
        { status: 409, headers: { "Content-Type": "application/json" } });
    }
  } catch (err: any) {
    return jsonError("check_dup", err);
  }

  // 전년 실적 집계 (Y-1 연도 expenses) — 목(budget_account_id) 단위
  let prevActualMap: Map<number, number> = new Map();
  try {
    const prevYear = fiscalYear - 1;
    const actuals: any = await db.execute(sql`
      SELECT budget_account_id, COALESCE(SUM(amount - refund_amount), 0)::bigint AS actual
      FROM expenses
      WHERE fiscal_year = ${prevYear} AND status = 'approved' AND budget_account_id IS NOT NULL
      GROUP BY budget_account_id
    `);
    for (const r of (actuals?.rows ?? actuals ?? [])) {
      prevActualMap.set(Number(r.budget_account_id), Number(r.actual));
    }
  } catch (err: any) {
    console.warn("전년 실적 집계 실패 (빈 값으로 계속):", err?.message);
  }

  // 활성 예산과목 '목(目·leaf)' 목록 — 편성은 목 단위
  let moks: any[] = [];
  try {
    const mokRows: any = await db.execute(sql`
      SELECT id FROM budget_accounts WHERE level = '목' AND is_active = TRUE ORDER BY sort_order, code
    `);
    moks = mokRows?.rows ?? mokRows ?? [];
  } catch (err: any) {
    return jsonError("select_moks", err);
  }

  // 예산안 생성 + budget_lines 일괄 INSERT
  let newPlanId: number;
  try {
    const planResult: any = await db.execute(sql`
      INSERT INTO budget_plans (fiscal_year, title, status, total_planned, created_by, created_at, updated_at)
      VALUES (${fiscalYear}, ${planTitle}, 'draft', 0, ${adminId}, NOW(), NOW())
      RETURNING id
    `);
    newPlanId = Number((planResult?.rows ?? planResult ?? [])[0].id);
  } catch (err: any) {
    return jsonError("insert_plan", err);
  }

  let totalPlanned = 0;
  try {
    for (const m of moks) {
      const mokId = Number(m.id);
      const prevActual = prevActualMap.get(mokId) ?? 0;
      totalPlanned += prevActual;
      await db.execute(sql`
        INSERT INTO budget_lines (plan_id, budget_account_id, category_id, planned_amount, prev_year_actual)
        VALUES (${newPlanId}, ${mokId}, NULL, ${prevActual}, ${prevActual})
        ON CONFLICT (plan_id, budget_account_id) DO NOTHING
      `);
    }
    // total_planned 캐시 갱신
    await db.execute(sql`
      UPDATE budget_plans SET total_planned = ${totalPlanned}, updated_at = NOW()
      WHERE id = ${newPlanId}
    `);
  } catch (err: any) {
    return jsonError("insert_lines", err);
  }

  return new Response(jsonKST({
    ok: true,
    data: {
      planId: newPlanId,
      fiscalYear,
      title: planTitle,
      lineCount: moks.length,
      totalPlanned,
      message: `${fiscalYear}년도 예산안이 생성되었습니다. (전년 실적 자동 채움 · 예산과목 목 ${moks.length}개)`,
    },
  }), { status: 201, headers: { "Content-Type": "application/json" } });
}
