import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-budget-plan-detail" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "예산안 상세 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0");
  const fiscalYear = parseInt(url.searchParams.get("year") || "0");

  if (!id && !fiscalYear) {
    return new Response(JSON.stringify({ ok: false, error: "id 또는 year 파라미터 필요" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  let plan: any;
  try {
    const cond = id ? sql`WHERE bp.id = ${id}` : sql`WHERE bp.fiscal_year = ${fiscalYear}`;
    const rows: any = await db.execute(sql`
      SELECT
        bp.id, bp.fiscal_year, bp.title, bp.status, bp.total_planned,
        bp.created_by, bp.submitted_by, bp.submitted_at,
        bp.approved_by, bp.approved_at, bp.rejection_reason,
        bp.created_at, bp.updated_at
      FROM budget_plans bp
      ${cond}
      LIMIT 1
    `);
    const planRows = rows?.rows ?? rows ?? [];
    if (!planRows[0]) {
      return new Response(JSON.stringify({ ok: false, error: "예산안을 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
    plan = planRows[0];
  } catch (err: any) {
    return jsonError("select_plan", err);
  }

  let lines: any[] = [];
  try {
    const lineRows: any = await db.execute(sql`
      SELECT
        bl.id, bl.plan_id, bl.category_id, bl.planned_amount, bl.prev_year_actual, bl.note,
        ec.code AS category_code, ec.name AS category_name
      FROM budget_lines bl
      JOIN expense_categories ec ON ec.id = bl.category_id
      WHERE bl.plan_id = ${Number(plan.id)}
      ORDER BY ec.sort_order, ec.id
    `);
    lines = (lineRows?.rows ?? lineRows ?? []).map((r: any) => ({
      id:             Number(r.id),
      planId:         Number(r.plan_id),
      categoryId:     Number(r.category_id),
      categoryCode:   r.category_code,
      categoryName:   r.category_name,
      plannedAmount:  Number(r.planned_amount),
      prevYearActual: Number(r.prev_year_actual),
      note:           r.note,
    }));
  } catch (err: any) {
    console.warn("budget_lines 조회 실패:", err?.message);
  }

  return new Response(JSON.stringify({
    ok: true,
    data: {
      plan: {
        id:              Number(plan.id),
        fiscalYear:      Number(plan.fiscal_year),
        title:           plan.title,
        status:          plan.status,
        totalPlanned:    Number(plan.total_planned),
        createdBy:       plan.created_by ? Number(plan.created_by) : null,
        submittedBy:     plan.submitted_by ? Number(plan.submitted_by) : null,
        submittedAt:     plan.submitted_at,
        approvedBy:      plan.approved_by ? Number(plan.approved_by) : null,
        approvedAt:      plan.approved_at,
        rejectionReason: plan.rejection_reason,
        createdAt:       plan.created_at,
        updatedAt:       plan.updated_at,
      },
      lines,
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}
