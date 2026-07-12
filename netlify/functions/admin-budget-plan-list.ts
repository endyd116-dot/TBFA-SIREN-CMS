import { isoUTC } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-budget-plan-list" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "예산안 목록 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  try {
    const rows: any = await db.execute(sql`
      SELECT
        bp.id,
        bp.fiscal_year,
        bp.title,
        bp.status,
        bp.total_planned,
        bp.created_by,
        bp.submitted_by,
        bp.submitted_at,
        bp.approved_by,
        bp.approved_at,
        bp.rejection_reason,
        bp.created_at,
        bp.updated_at,
        (SELECT COUNT(*) FROM budget_lines bl WHERE bl.plan_id = bp.id)::int AS line_count
      FROM budget_plans bp
      ORDER BY bp.fiscal_year DESC
    `);
    const plans = (rows?.rows ?? rows ?? []).map((r: any) => ({
      id:              Number(r.id),
      fiscalYear:      Number(r.fiscal_year),
      title:           r.title,
      status:          r.status,
      totalPlanned:    Number(r.total_planned),
      createdBy:       r.created_by ? Number(r.created_by) : null,
      submittedBy:     r.submitted_by ? Number(r.submitted_by) : null,
      submittedAt:     isoUTC(r.submitted_at),
      approvedBy:      r.approved_by ? Number(r.approved_by) : null,
      approvedAt:      isoUTC(r.approved_at),
      rejectionReason: r.rejection_reason,
      createdAt:       isoUTC(r.created_at),
      updatedAt:       isoUTC(r.updated_at),
      lineCount:       Number(r.line_count),
    }));

    return new Response(
      JSON.stringify({ ok: true, data: { plans, total: plans.length } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return jsonError("select_plans", err);
  }
}
