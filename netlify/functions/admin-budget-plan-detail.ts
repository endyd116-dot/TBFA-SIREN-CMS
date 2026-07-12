import { isoUTC } from "../../lib/kst";
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
    // 목 기반 라인: 목→항→관 경로 조인 (레거시 category 라인은 LEFT JOIN으로 폴백)
    const lineRows: any = await db.execute(sql`
      SELECT
        bl.id, bl.plan_id, bl.budget_account_id, bl.category_id,
        bl.planned_amount, bl.prev_year_actual, bl.note,
        mok.code  AS mok_code,  mok.name  AS mok_name,
        hang.id   AS hang_id,   hang.code AS hang_code, hang.name AS hang_name,
        gwan.id   AS gwan_id,   gwan.code AS gwan_code, gwan.name AS gwan_name,
        ec.name AS category_name
      FROM budget_lines bl
      LEFT JOIN budget_accounts mok  ON mok.id  = bl.budget_account_id
      LEFT JOIN budget_accounts hang ON hang.id = mok.parent_id
      LEFT JOIN budget_accounts gwan ON gwan.id = hang.parent_id
      LEFT JOIN expense_categories ec ON ec.id = bl.category_id
      WHERE bl.plan_id = ${Number(plan.id)}
      ORDER BY gwan.sort_order NULLS LAST, gwan.code, hang.sort_order, hang.code, mok.sort_order, mok.code
    `);
    lines = (lineRows?.rows ?? lineRows ?? []).map((r: any) => ({
      id:             Number(r.id),
      planId:         Number(r.plan_id),
      budgetAccountId: r.budget_account_id != null ? Number(r.budget_account_id) : null,
      categoryId:     r.category_id != null ? Number(r.category_id) : null,
      gwanId:         r.gwan_id != null ? Number(r.gwan_id) : null,
      gwanName:       r.gwan_name || null,
      hangId:         r.hang_id != null ? Number(r.hang_id) : null,
      hangName:       r.hang_name || null,
      mokCode:        r.mok_code || null,
      mokName:        r.mok_name || r.category_name || '(미분류)',
      // 하위호환: 기존 UI가 참조하던 키
      categoryName:   r.mok_name || r.category_name || '',
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
        submittedAt:     isoUTC(plan.submitted_at),
        approvedBy:      plan.approved_by ? Number(plan.approved_by) : null,
        approvedAt:      isoUTC(plan.approved_at),
        rejectionReason: plan.rejection_reason,
        createdAt:       isoUTC(plan.created_at),
        updatedAt:       isoUTC(plan.updated_at),
      },
      lines,
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}
