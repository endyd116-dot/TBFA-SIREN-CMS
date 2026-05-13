import { db } from "../../db";
import { expenseCategories } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { asc } from "drizzle-orm";

export const config = { path: "/api/admin-expense-categories-list" };

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let rows: typeof expenseCategories.$inferSelect[] = [];
  try {
    rows = await db
      .select()
      .from(expenseCategories)
      .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.id));
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "지출 카테고리 목록 조회 실패", step: "select_categories",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const items = rows.map(r => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
  }));

  return new Response(JSON.stringify({ ok: true, data: { items } }), {
    headers: { "Content-Type": "application/json" },
  });
}
