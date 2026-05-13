import { db } from "../../db";
import { revenueCategories } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { asc } from "drizzle-orm";

export const config = { path: "/api/admin-revenue-categories-list" };

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let rows: typeof revenueCategories.$inferSelect[] = [];
  try {
    rows = await db
      .select()
      .from(revenueCategories)
      .orderBy(asc(revenueCategories.sortOrder), asc(revenueCategories.id));
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "카테고리 목록 조회 실패", step: "select_categories",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const items = rows.map(r => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
  }));

  return new Response(JSON.stringify({ ok: true, data: { items } }), {
    headers: { "Content-Type": "application/json" },
  });
}
