import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { donations, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { sql, and, gte, lte, eq } from "drizzle-orm";

export const config = { path: "/api/admin-finance-report" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") || String(new Date().getFullYear()));
  const monthParam = url.searchParams.get("month");
  const month = monthParam ? parseInt(monthParam) : null;
  const quarter = url.searchParams.get("quarter") ? parseInt(url.searchParams.get("quarter")!) : null;

  // 기간 계산
  let startDate: Date, endDate: Date;
  if (month) {
    startDate = new Date(year, month - 1, 1);
    endDate = new Date(year, month, 0, 23, 59, 59);
  } else if (quarter) {
    const qStart = (quarter - 1) * 3;
    startDate = new Date(year, qStart, 1);
    endDate = new Date(year, qStart + 3, 0, 23, 59, 59);
  } else {
    startDate = new Date(year, 0, 1);
    endDate = new Date(year, 11, 31, 23, 59, 59);
  }

  try {
    // 수입 집계
    let income = { total: 0, byChannel: {} as Record<string, number>, monthly: [] as any[] };
    try {
      const incomeRows = await db
        .select({
          provider: donations.pgProvider,
          amount: sql<number>`coalesce(sum(${donations.amount}),0)::int`,
        })
        .from(donations)
        .where(
          and(
            eq(donations.status, "completed"),
            gte(donations.createdAt, startDate),
            lte(donations.createdAt, endDate)
          )
        )
        .groupBy(donations.pgProvider);

      for (const r of incomeRows) {
        const p = (r.provider ?? "other").toLowerCase();
        const key = p.includes("toss") ? "toss" : p.includes("hyosung") ? "hyosung" : p === "bank" ? "bank" : "other";
        income.byChannel[key] = (income.byChannel[key] || 0) + r.amount;
        income.total += r.amount;
      }

      const monthRows = await db
        .select({
          m: sql<number>`extract(month from ${donations.createdAt})::int`,
          amount: sql<number>`coalesce(sum(${donations.amount}),0)::int`,
        })
        .from(donations)
        .where(
          and(
            eq(donations.status, "completed"),
            gte(donations.createdAt, startDate),
            lte(donations.createdAt, endDate)
          )
        )
        .groupBy(sql`extract(month from ${donations.createdAt})`);
      income.monthly = monthRows.map((r) => ({ month: r.m, amount: r.amount }));
    } catch (err) {
      console.warn("[finance-report] income 집계 실패:", err);
    }

    // 지출 집계 (expenditures 테이블 — 마이그 후 활성화)
    let expenditure = { total: 0, byCategory: [] as any[], monthly: [] as any[] };
    try {
      const expRows = await db.execute(sql`
        SELECT
          bc.name AS category_name,
          bc.code AS category_code,
          COALESCE(SUM(e.amount),0)::int AS amount,
          COUNT(e.id)::int AS count
        FROM expenditures e
        JOIN budget_categories bc ON bc.id = e.category_id
        WHERE e.status = 'approved'
          AND e.spent_at BETWEEN ${startDate.toISOString().slice(0,10)} AND ${endDate.toISOString().slice(0,10)}
        GROUP BY bc.id, bc.name, bc.code
        ORDER BY amount DESC
      `);
      const expItems = expRows.rows || expRows;
      expenditure.byCategory = expItems as any[];
      expenditure.total = (expItems as any[]).reduce((s, r) => s + (r.amount || 0), 0);

      const expMonthly = await db.execute(sql`
        SELECT
          EXTRACT(MONTH FROM spent_at)::int AS month,
          COALESCE(SUM(amount),0)::int AS amount
        FROM expenditures
        WHERE status = 'approved'
          AND spent_at BETWEEN ${startDate.toISOString().slice(0,10)} AND ${endDate.toISOString().slice(0,10)}
        GROUP BY EXTRACT(MONTH FROM spent_at)
        ORDER BY month
      `);
      expenditure.monthly = (expMonthly.rows || expMonthly) as any[];
    } catch (err) {
      console.warn("[finance-report] expenditure 집계 실패 (테이블 미생성일 수 있음):", err);
    }

    // 예산 대비 실적
    let budgetVsActual: any[] = [];
    try {
      const bvaRows = await db.execute(sql`
        SELECT
          bc.name,
          bc.code,
          COALESCE(b.planned_amount,0)::int AS budget,
          COALESCE(ex.executed,0)::int AS actual,
          CASE WHEN b.planned_amount > 0
            THEN ROUND(COALESCE(ex.executed,0)::numeric / b.planned_amount * 100)
            ELSE 0
          END::int AS rate
        FROM budget_categories bc
        LEFT JOIN budgets b ON b.category_id = bc.id AND b.fiscal_year = ${year}
        LEFT JOIN (
          SELECT category_id, SUM(amount)::int AS executed
          FROM expenditures
          WHERE status = 'approved'
            AND EXTRACT(YEAR FROM spent_at) = ${year}
          GROUP BY category_id
        ) ex ON ex.category_id = bc.id
        WHERE bc.is_active = TRUE
        ORDER BY bc.id
      `);
      budgetVsActual = (bvaRows.rows || bvaRows) as any[];
    } catch (err) {
      console.warn("[finance-report] budgetVsActual 집계 실패:", err);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          year, month, quarter,
          period: { start: startDate.toISOString().slice(0, 10), end: endDate.toISOString().slice(0, 10) },
          income,
          expenditure,
          balance: income.total - expenditure.total,
          budgetVsActual,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "재무 보고서 조회 실패", step: "query",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
