import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-finance-expenditure-list" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "all";
  const category = url.searchParams.get("category") || "all";
  const year = url.searchParams.get("year") || String(new Date().getFullYear());
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = 20;
  const offset = (page - 1) * limit;

  try {
    const rows = await db.execute(sql`
      SELECT
        e.id,
        e.amount,
        e.spent_at,
        e.description,
        e.payee,
        e.status,
        e.receipt_url,
        e.created_at,
        e.approved_at,
        e.note,
        bc.name AS category_name,
        bc.code AS category_code,
        creator.name AS created_by_name,
        approver.name AS approved_by_name
      FROM expenditures e
      LEFT JOIN budget_categories bc ON bc.id = e.category_id
      LEFT JOIN admins creator ON creator.id = e.created_by
      LEFT JOIN admins approver ON approver.id = e.approved_by
      WHERE (${status} = 'all' OR e.status = ${status})
        AND (${category} = 'all' OR bc.code = ${category})
        AND EXTRACT(YEAR FROM e.spent_at) = ${year}::int
      ORDER BY e.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const [countRow] = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM expenditures e
      LEFT JOIN budget_categories bc ON bc.id = e.category_id
      WHERE (${status} = 'all' OR e.status = ${status})
        AND (${category} = 'all' OR bc.code = ${category})
        AND EXTRACT(YEAR FROM e.spent_at) = ${year}::int
    `);

    const total = (countRow as any)?.total || 0;

    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          items: rows.rows || rows,
          total,
          page,
          totalPages: Math.ceil(total / limit),
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "지출 목록 조회 실패", step: "query",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
