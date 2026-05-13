import { db } from "../../db";
import { expenseCategories } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { eq } from "drizzle-orm";

export const config = { path: "/api/admin-expense-category-create" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  if (auth.ctx.admin.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민만 카테고리를 추가할 수 있습니다", step: "auth_role" }), { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "요청 본문 파싱 실패", step: "parse" }), { status: 400 });
  }

  const { code, name, description, sortOrder } = body;

  if (!code || !name) {
    return new Response(JSON.stringify({ ok: false, error: "code, name 필수", step: "validate" }), { status: 400 });
  }

  const codeStr = String(code).trim().slice(0, 32);
  if (!/^[a-z0-9_-]+$/i.test(codeStr)) {
    return new Response(JSON.stringify({ ok: false, error: "code는 영문·숫자·_- 만 사용 가능", step: "validate_code" }), { status: 400 });
  }

  // 중복 체크
  let existing: typeof expenseCategories.$inferSelect[] = [];
  try {
    existing = await db.select().from(expenseCategories).where(eq(expenseCategories.code, codeStr)).limit(1);
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "코드 중복 확인 실패", step: "select_existing",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }
  if (existing.length) {
    return new Response(JSON.stringify({ ok: false, error: "이미 사용 중인 코드입니다", step: "duplicate_code" }), { status: 400 });
  }

  let inserted: typeof expenseCategories.$inferSelect[] = [];
  try {
    inserted = await db.insert(expenseCategories).values({
      code: codeStr,
      name: String(name).trim().slice(0, 100),
      description: description ? String(description) : null,
      isSystem: false,
      sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
      isActive: true,
    } as any).returning();
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "카테고리 등록 실패", step: "insert",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }

  const r = inserted[0];
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
