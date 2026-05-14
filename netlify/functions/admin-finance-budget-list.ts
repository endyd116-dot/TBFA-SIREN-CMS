import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-finance-budget-list" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "예산 집행률 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") || String(new Date().getFullYear()));

  // 1. 해당 연도의 approved 예산안 조회
  let plan: any = null;
  try {
    const planRows: any = await db.execute(sql`
      SELECT id, fiscal_year, title, status, total_planned, approved_at
      FROM budget_plans
      WHERE fiscal_year = ${year} AND status = 'approved'
      LIMIT 1
    `);
    plan = (planRows?.rows ?? planRows ?? [])[0] ?? null;
  } catch (err: any) {
    return jsonError("select_plan", err);
  }

  // 승인된 예산안 없을 때
  if (!plan) {
    // 다른 상태 예산안 존재 여부 확인
    let planStatus: string | null = null;
    let allPlans: any[] = [];
    try {
      const allRows: any = await db.execute(sql`
        SELECT id, fiscal_year, title, status FROM budget_plans WHERE fiscal_year = ${year} LIMIT 1
      `);
      const arr = allRows?.rows ?? allRows ?? [];
      if (arr[0]) planStatus = arr[0].status;

      const allYears: any = await db.execute(sql`
        SELECT id, fiscal_year, title, status FROM budget_plans ORDER BY fiscal_year DESC LIMIT 10
      `);
      allPlans = (allYears?.rows ?? allYears ?? []).map((r: any) => ({
        id: Number(r.id), fiscalYear: Number(r.fiscal_year), title: r.title, status: r.status,
      }));
    } catch { /* 보조 조회 실패는 무시 */ }

    return new Response(JSON.stringify({
      ok: true,
      data: {
        year,
        noPlan: true,
        planStatus,
        allPlans,
        items: [],
        totalPlanned: 0,
        totalExecuted: 0,
        message: `${year}년도 승인된 예산안이 없습니다. 예산안을 편성·승인 후 집행률 확인이 가능합니다.`,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // 2. budget_lines 조회
  let lines: any[] = [];
  try {
    const lineRows: any = await db.execute(sql`
      SELECT
        bl.id, bl.category_id, bl.planned_amount, bl.prev_year_actual, bl.note,
        ec.code AS category_code, ec.name AS category_name
      FROM budget_lines bl
      JOIN expense_categories ec ON ec.id = bl.category_id
      WHERE bl.plan_id = ${Number(plan.id)}
      ORDER BY ec.sort_order, ec.id
    `);
    lines = lineRows?.rows ?? lineRows ?? [];
  } catch (err: any) {
    return jsonError("select_lines", err);
  }

  // 3. expenses 집계 (status='approved', fiscal_year 매칭)
  let execByCatId: Map<number, number> = new Map();
  try {
    const execRows: any = await db.execute(sql`
      SELECT category_id, COALESCE(SUM(amount - refund_amount), 0)::bigint AS executed
      FROM expenses
      WHERE fiscal_year = ${year} AND status = 'approved'
      GROUP BY category_id
    `);
    for (const r of (execRows?.rows ?? execRows ?? [])) {
      execByCatId.set(Number(r.category_id), Number(r.executed));
    }
  } catch (err: any) {
    console.warn("expenses 집계 실패 (0으로 계속):", err?.message);
  }

  // 4. 결합
  const items = lines.map((r: any) => {
    const planned  = Number(r.planned_amount);
    const executed = execByCatId.get(Number(r.category_id)) ?? 0;
    const remaining = planned - executed;
    return {
      id:             Number(r.id),
      categoryId:     Number(r.category_id),
      categoryCode:   r.category_code,
      categoryName:   r.category_name,
      plannedAmount:  planned,
      executedAmount: executed,
      remaining,
      rate:           planned > 0 ? Math.round((executed / planned) * 100) : 0,
      prevYearActual: Number(r.prev_year_actual),
      note:           r.note,
    };
  });

  const totalPlanned  = items.reduce((s, i) => s + i.plannedAmount, 0);
  const totalExecuted = items.reduce((s, i) => s + i.executedAmount, 0);

  return new Response(JSON.stringify({
    ok: true,
    data: {
      year,
      noPlan: false,
      planStatus: plan.status,
      plan: {
        id:           Number(plan.id),
        title:        plan.title,
        totalPlanned: Number(plan.total_planned),
        approvedAt:   plan.approved_at,
      },
      items,
      totalPlanned,
      totalExecuted,
      totalRemaining: totalPlanned - totalExecuted,
      executionRate: totalPlanned > 0 ? Math.round((totalExecuted / totalPlanned) * 100) : 0,
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}
