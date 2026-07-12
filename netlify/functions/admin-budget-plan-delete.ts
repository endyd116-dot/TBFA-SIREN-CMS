import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-budget-plan-delete" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "예산안 삭제 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "DELETE") {
    return new Response(jsonKST({ ok: false, error: "DELETE 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const planId = parseInt(url.searchParams.get("id") || "0");
  if (!planId) {
    return new Response(jsonKST({ ok: false, error: "id 파라미터 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const planRows: any = await db.execute(sql`
      SELECT id, status, fiscal_year FROM budget_plans WHERE id = ${planId} LIMIT 1
    `);
    const plan = (planRows?.rows ?? planRows ?? [])[0];
    if (!plan) {
      return new Response(jsonKST({ ok: false, error: "예산안을 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (plan.status !== "draft") {
      return new Response(jsonKST({ ok: false, error: `draft 상태에서만 삭제 가능 (현재: ${plan.status})` }),
        { status: 422, headers: { "Content-Type": "application/json" } });
    }

    // budget_lines는 ON DELETE CASCADE로 함께 삭제됨
    await db.execute(sql`DELETE FROM budget_plans WHERE id = ${planId}`);

    return new Response(jsonKST({
      ok: true,
      data: { message: `${plan.fiscal_year}년도 예산안이 삭제되었습니다.` },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("delete", err);
  }
}
