import { db } from "../../db";
import { expenseCategories } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { eq } from "drizzle-orm";

export const config = { path: "/api/admin-expense-category-update" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "PUT") {
    return new Response(JSON.stringify({ ok: false, error: "PUT만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  if (auth.ctx.admin.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민만 카테고리를 수정할 수 있습니다", step: "auth_role" }), { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "요청 본문 파싱 실패", step: "parse" }), { status: 400 });
  }

  const { id, name, description, sortOrder, isActive } = body;

  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: "id 필수", step: "validate" }), { status: 400 });
  }

  let existing: typeof expenseCategories.$inferSelect[] = [];
  try {
    existing = await db.select().from(expenseCategories).where(eq(expenseCategories.id, Number(id))).limit(1);
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "카테고리 조회 실패", step: "select_category",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }
  if (!existing.length) {
    return new Response(JSON.stringify({ ok: false, error: "존재하지 않는 카테고리", step: "not_found" }), { status: 404 });
  }

  const cat = existing[0];
  const updateData: Record<string, any> = { updatedAt: new Date() };

  // isSystem=true: sortOrder·isActive만 허용
  if (cat.isSystem) {
    if (name !== undefined || description !== undefined) {
      return new Response(JSON.stringify({
        ok: false, error: "기본(시스템) 카테고리는 이름·설명을 수정할 수 없습니다", step: "validate_system",
      }), { status: 400 });
    }
    if (sortOrder !== undefined) updateData.sortOrder = Number(sortOrder);
    if (isActive !== undefined) updateData.isActive = !!isActive;
  } else {
    if (name !== undefined) updateData.name = String(name).trim().slice(0, 100);
    if (description !== undefined) updateData.description = description ? String(description) : null;
    if (sortOrder !== undefined) updateData.sortOrder = Number(sortOrder);
    if (isActive !== undefined) updateData.isActive = !!isActive;
  }

  if (Object.keys(updateData).length <= 1) {
    return new Response(JSON.stringify({ ok: false, error: "수정할 필드가 없습니다", step: "validate_fields" }), { status: 400 });
  }

  let updated: typeof expenseCategories.$inferSelect[] = [];
  try {
    updated = await db
      .update(expenseCategories)
      .set(updateData as any)
      .where(eq(expenseCategories.id, Number(id)))
      .returning();
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "카테고리 수정 실패", step: "update",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }

  const r = updated[0];
  return new Response(JSON.stringify({
    ok: true,
    data: {
      category: {
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        sortOrder: r.sortOrder,
        isActive: r.isActive,
      },
    },
  }), { headers: { "Content-Type": "application/json" } });
}
