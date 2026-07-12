import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { requireRole, roleForbidden } from "../../lib/admin-role";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-budget-plan-approve" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "예산안 승인 실패", step,
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

  // super_admin만 승인 가능
  if (!requireRole(auth.ctx.member, "super_admin")) return roleForbidden("super_admin");
  const adminId = auth.ctx.admin.uid;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { planId } = body;
  if (!planId) {
    return new Response(jsonKST({ ok: false, error: "planId 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const planRows: any = await db.execute(sql`
      SELECT id, status, fiscal_year FROM budget_plans WHERE id = ${Number(planId)} LIMIT 1
    `);
    const plan = (planRows?.rows ?? planRows ?? [])[0];
    if (!plan) {
      return new Response(jsonKST({ ok: false, error: "예산안을 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (plan.status !== "submitted") {
      return new Response(jsonKST({ ok: false, error: `submitted 상태에서만 승인 가능 (현재: ${plan.status})` }),
        { status: 422, headers: { "Content-Type": "application/json" } });
    }

    await db.execute(sql`
      UPDATE budget_plans
      SET status = 'approved',
          approved_by = ${adminId},
          approved_at = NOW(),
          rejection_reason = NULL,
          updated_at = NOW()
      WHERE id = ${Number(planId)}
    `);

    return new Response(jsonKST({
      ok: true,
      data: { message: `${plan.fiscal_year}년도 예산안이 승인되었습니다.` },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("approve", err);
  }
}
