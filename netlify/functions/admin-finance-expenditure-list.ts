import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-finance-expenditure-list" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  // ⚠️ DEPRECATED (Phase 22-B-R1): expenditures → expenses 단일화 완료
  // 이 API는 회귀 방지를 위해 임시 유지되며 곧 삭제됩니다.
  // 대신 /api/admin-expense-list 를 사용하세요.
  const DEPRECATED_WARNING = {
    deprecated: true,
    useInstead: "admin-expense-list",
    message: "이 API는 지출 시스템 단일화(Phase 22-B-R1)로 deprecated 되었습니다. /api/admin-expense-list 를 사용하세요.",
  };

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
      LEFT JOIN members creator ON creator.id = e.created_by
      LEFT JOIN members approver ON approver.id = e.approved_by
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
        ...DEPRECATED_WARNING,
        data: {
          items: (rows as any).rows || rows as any[],
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
