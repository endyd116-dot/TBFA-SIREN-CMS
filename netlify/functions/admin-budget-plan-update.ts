import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-budget-plan-update" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "예산안 수정 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "PUT") {
    return new Response(JSON.stringify({ ok: false, error: "PUT 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { planId, lines, title } = body;
  // lines: [{ lineId, plannedAmount, note }]
  if (!planId) {
    return new Response(JSON.stringify({ ok: false, error: "planId 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // draft 상태 체크
  let plan: any;
  try {
    const planRows: any = await db.execute(sql`
      SELECT id, status FROM budget_plans WHERE id = ${Number(planId)} LIMIT 1
    `);
    plan = (planRows?.rows ?? planRows ?? [])[0];
    if (!plan) {
      return new Response(JSON.stringify({ ok: false, error: "예산안을 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (plan.status !== "draft" && plan.status !== "rejected") {
      return new Response(JSON.stringify({ ok: false, error: `draft 또는 rejected 상태에서만 수정 가능 (현재: ${plan.status})` }),
        { status: 422, headers: { "Content-Type": "application/json" } });
    }
  } catch (err: any) {
    return jsonError("select_plan", err);
  }

  try {
    // 제목 수정
    if (title) {
      await db.execute(sql`
        UPDATE budget_plans SET title = ${title}, updated_at = NOW() WHERE id = ${Number(planId)}
      `);
    }

    // budget_lines 금액 수정
    if (Array.isArray(lines) && lines.length > 0) {
      for (const line of lines) {
        const { lineId, plannedAmount, note } = line;
        if (!lineId) continue;
        await db.execute(sql`
          UPDATE budget_lines
          SET planned_amount = ${Number(plannedAmount ?? 0)},
              note = ${note ?? null}
          WHERE id = ${Number(lineId)} AND plan_id = ${Number(planId)}
        `);
      }
    }

    // total_planned 캐시 재계산
    await db.execute(sql`
      UPDATE budget_plans
      SET total_planned = (
        SELECT COALESCE(SUM(planned_amount), 0) FROM budget_lines WHERE plan_id = ${Number(planId)}
      ),
      updated_at = NOW()
      WHERE id = ${Number(planId)}
    `);

    return new Response(JSON.stringify({ ok: true, data: { message: "예산안이 수정되었습니다" } }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("update", err);
  }
}
