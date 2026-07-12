import { jsonKST } from "../../lib/kst";
import { db } from "../../db";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-revenue-categories-list" };

/**
 * 매출 카테고리 목록 — 계층(parent_id) + 시스템 보호(is_system) 포함.
 * ?all=1 이면 비활성 카테고리 포함, 기본은 활성만.
 * 마이그(parent_id·is_system 추가) 전후 모두 동작하도록 방어적 SELECT.
 */
export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("all") === "1";

  let rows: any[] = [];
  let hasHierarchy = true;
  try {
    const r: any = await db.execute(sql`
      SELECT id, code, name, description, parent_id, is_system, sort_order, is_active
      FROM revenue_categories
      ${includeInactive ? sql`` : sql`WHERE is_active = TRUE`}
      ORDER BY sort_order ASC, id ASC`);
    rows = r?.rows ?? r ?? [];
  } catch {
    // 마이그 전 — parent_id·is_system 컬럼 없음 → 평면 조회로 폴백
    hasHierarchy = false;
    try {
      const r: any = await db.execute(sql`
        SELECT id, code, name, description, sort_order, is_active
        FROM revenue_categories
        ${includeInactive ? sql`` : sql`WHERE is_active = TRUE`}
        ORDER BY sort_order ASC, id ASC`);
      rows = r?.rows ?? r ?? [];
    } catch (err: any) {
      return new Response(jsonKST({
        ok: false, error: "카테고리 목록 조회 실패", step: "select_categories",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  const items = rows.map((r: any) => ({
    id:          Number(r.id),
    code:        r.code,
    name:        r.name,
    description: r.description,
    parentId:    r.parent_id != null ? Number(r.parent_id) : null,
    isSystem:    r.is_system === true,
    sortOrder:   Number(r.sort_order),
    isActive:    r.is_active,
  }));

  return new Response(jsonKST({ ok: true, data: { items, hasHierarchy } }), {
    headers: { "Content-Type": "application/json" },
  });
}
