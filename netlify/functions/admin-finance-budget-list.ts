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
    // 1. 예산 목록 (budget_categories + budgets)
    // budget_categories는 유지 (R2 예산 편성에서 사용)
    const budgetRows: any = await db.execute(sql`
      SELECT
        bc.id AS bc_id,
        bc.name AS bc_name,
        bc.code AS bc_code,
        COALESCE(b.planned_amount, 0)::bigint AS planned_amount
      FROM budget_categories bc
      LEFT JOIN budgets b
        ON b.category_id = bc.id AND b.fiscal_year = ${year}
      WHERE bc.is_active = TRUE
      ORDER BY bc.id
    `);
    const budRows: any[] = (budgetRows as any)?.rows ?? (budgetRows as any[]) ?? [];

    // 2. expense_categories 코드 → ID 매핑 (budget_categories.code와 동일 코드 기준 매칭)
    //    22-B-R1 마이그레이션 후 budget_categories.code = expense_categories.code 로 1:1 대응
    const expCatR: any = await db.execute(sql`
      SELECT id, code FROM expense_categories WHERE is_active = TRUE
    `);
    const expCatRows: any[] = expCatR?.rows ?? expCatR ?? [];
    const expCatByCode = new Map<string, number>(
      expCatRows.map((r: any) => [r.code, Number(r.id)])
    );

    // 3. expenses 기준 카테고리별 집행 집계
    //    (22-C expenses 테이블, status='approved', fiscal_year 매칭)
    const execR: any = await db.execute(sql`
      SELECT
        e.category_id AS exp_cat_id,
        COALESCE(SUM(e.amount - e.refund_amount), 0)::bigint AS executed_amount,
        COUNT(*)::int AS executed_count
      FROM expenses e
      WHERE e.status = 'approved'
        AND e.fiscal_year = ${year}
      GROUP BY e.category_id
    `);
    const execRows: any[] = execR?.rows ?? execR ?? [];
    const execByCatId = new Map<number, { amount: number; count: number }>(
      execRows.map((r: any) => [Number(r.exp_cat_id), {
        amount: Number(r.executed_amount),
        count: Number(r.executed_count),
      }])
    );

    // 4. 카테고리별 결합 — budget_categories.code → expense_categories.id 경유
    const items = budRows.map((r: any) => {
      const planned = Number(r.planned_amount);
      const expCatId = expCatByCode.get(r.bc_code) ?? null;
      const exec = expCatId !== null ? (execByCatId.get(expCatId) ?? { amount: 0, count: 0 }) : { amount: 0, count: 0 };
      const executed = exec.amount;
      return {
        id: r.bc_id,
        name: r.bc_name,
        code: r.bc_code,
        plannedAmount: planned,
        executedAmount: executed,
        executedCount: exec.count,
        remaining: planned - executed,
        rate: planned > 0 ? Math.round((executed / planned) * 100) : 0,
      };
    });

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
