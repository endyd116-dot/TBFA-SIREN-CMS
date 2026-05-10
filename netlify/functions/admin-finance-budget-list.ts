import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-finance-budget-list" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") || String(new Date().getFullYear()));

  try {
    // 예산 + 집행 집계 (카테고리별)
    const rows = await db.execute(sql`
      SELECT
        bc.id,
        bc.name,
        bc.code,
        COALESCE(b.planned_amount, 0)::int AS planned_amount,
        COALESCE(ex.executed_amount, 0)::int AS executed_amount,
        COALESCE(ex.executed_count, 0)::int AS executed_count
      FROM budget_categories bc
      LEFT JOIN budgets b
        ON b.category_id = bc.id AND b.fiscal_year = ${year}
      LEFT JOIN (
        SELECT
          category_id,
          SUM(amount)::int AS executed_amount,
          COUNT(*)::int AS executed_count
        FROM expenditures
        WHERE status = 'approved'
          AND EXTRACT(YEAR FROM spent_at) = ${year}
        GROUP BY category_id
      ) ex ON ex.category_id = bc.id
      WHERE bc.is_active = TRUE
      ORDER BY bc.id
    `);

    const items = ((rows as any).rows || rows as any[]).map((r: any) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      plannedAmount: r.planned_amount,
      executedAmount: r.executed_amount,
      executedCount: r.executed_count,
      remaining: r.planned_amount - r.executed_amount,
      rate: r.planned_amount > 0
        ? Math.round((r.executed_amount / r.planned_amount) * 100)
        : 0,
    }));

    const totalPlanned = items.reduce((s: number, i: any) => s + i.plannedAmount, 0);
    const totalExecuted = items.reduce((s: number, i: any) => s + i.executedAmount, 0);

    return new Response(
      JSON.stringify({ ok: true, data: { year, items, totalPlanned, totalExecuted } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "예산 집계 조회 실패", step: "query",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
