// netlify/functions/admin-resource-categories.ts
// ★ Phase M-19-8: 자료실 카테고리 마스터 CRUD
//
// GET    /api/admin/resource-categories           — 전체 목록 + 자료 카운트
// GET    /api/admin/resource-categories?id=N      — 단건 상세
// POST   /api/admin/resource-categories           — 신규 생성
// PATCH  /api/admin/resource-categories           — 수정 (body: { id, ...fields })
// DELETE /api/admin/resource-categories?id=N      — 삭제 (resources.categoryId는 SET NULL)
//
// 권한: super_admin 또는 'all' 카테고리 담당자만

import { eq, asc, sql } from "drizzle-orm";
import { db } from "../../db";
import { resourceCategories, resources } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

/* ───────── 권한 체크 ───────── */
function canEdit(adminMember: any): boolean {
  if (!adminMember) return false;
  if (adminMember.role === "super_admin") return true;
  const cats: string[] = Array.isArray(adminMember.assignedCategories)
    ? adminMember.assignedCategories
    : [];
  return cats.includes("all");
}

/* ───────── code 정규화 (영소문자/숫자/언더스코어/하이픈) ───────── */
function normalizeCode(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 50);
}

/* ───────── 입력 검증 ───────── */
function validateInput(
  body: any,
  isCreate: boolean
): { ok: true; data: any } | { ok: false; error: string } {
  const data: any = {};

  if (isCreate || body.code !== undefined) {
    const code = normalizeCode(body.code || "");
    if (!code || code.length < 2) return { ok: false, error: "code는 2자 이상의 영문/숫자/언더스코어여야 합니다" };
    data.code = code;
  }

  if (isCreate || body.nameKo !== undefined) {
    const n = String(body.nameKo || "").trim();
    if (!n) return { ok: false, error: "이름(nameKo)은 필수입니다" };
    if (n.length > 100) return { ok: false, error: "이름은 100자 이내로 작성해주세요" };
    data.nameKo = n;
  }

  if (body.description !== undefined) {
    data.description = body.description === null ? null : String(body.description).slice(0, 300);
  }

  if (body.icon !== undefined) {
    data.icon = body.icon === null ? null : String(body.icon).slice(0, 10);
  }

  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isFinite(n)) return { ok: false, error: "sortOrder는 숫자여야 합니다" };
    data.sortOrder = Math.max(0, Math.min(9999, Math.floor(n)));
  }

  if (body.isActive !== undefined) data.isActive = !!body.isActive;

  return { ok: true, data };
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member: adminMember } = guard.ctx;

  try {
    /* ===== GET ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const idParam = url.searchParams.get("id");

      /* ── 단건 상세 ── */
      if (idParam) {
        const id = Number(idParam);
        if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

        const [row] = await db
          .select()
          .from(resourceCategories)
          .where(eq(resourceCategories.id, id))
          .limit(1);
        if (!row) return notFound("카테고리를 찾을 수 없습니다");

        /* 자료 카운트 (전체 — published 무관) */
        const cntRow: any = await db
          .select({ c: sql<number>`COUNT(*)::int` })
          .from(resources)
          .where(eq(resources.categoryId, id));
        const resourceCount = Number(cntRow[0]?.c ?? 0);

        return ok({ category: { ...row, resourceCount } });
      }

      /* ── 목록 ── */
      const list = await db
        .select()
        .from(resourceCategories)
        .orderBy(asc(resourceCategories.sortOrder), asc(resourceCategories.id));

      /* 카테고리별 자료 카운트 (published만) */
      const countsRaw: any = await db.execute(sql`
        SELECT category_id, COUNT(*)::int AS cnt
        FROM resources
        WHERE is_published = true
        GROUP BY category_id
      `);
      const rows = countsRaw.rows || countsRaw || [];
      const countMap: Record<string, number> = {};
      for (const r of rows as any[]) {
        if (r.category_id) countMap[String(r.category_id)] = Number(r.cnt) || 0;
      }

      const enriched = list.map((c: any) => ({
        ...c,
        resourceCount: countMap[String(c.id)] || 0,
      }));

      return ok({ list: enriched });
    }

    /* ===== POST: 신규 생성 ===== */
    if (req.method === "POST") {
      if (!canEdit(adminMember)) {
        return forbidden("카테고리 생성 권한이 없습니다 (super_admin 또는 'all' 담당자만 가능)");
      }

      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const v = validateInput(body, true);
      if (!v.ok) return badRequest(v.error);

      /* code 중복 체크 */
      const [dup] = await db
        .select({ id: resourceCategories.id })
        .from(resourceCategories)
        .where(eq(resourceCategories.code, v.data.code))
        .limit(1);
      if (dup) return badRequest("이미 사용 중인 code입니다");

      const [created] = await db.insert(resourceCategories).values(v.data).returning();

      try {
        await logAdminAction(req, admin.uid, admin.name, "resource_category_create", {
          target: `RC-${created.id}`,
          detail: { code: created.code, nameKo: created.nameKo },
        });
      } catch (_) {}

      return ok({ category: created }, "카테고리가 생성되었습니다");
    }

    /* ===== PATCH: 수정 ===== */
    if (req.method === "PATCH") {
      if (!canEdit(adminMember)) return forbidden("카테고리 수정 권한이 없습니다");

      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const [existing] = await db
        .select()
        .from(resourceCategories)
        .where(eq(resourceCategories.id, id))
        .limit(1);
      if (!existing) return notFound("카테고리를 찾을 수 없습니다");

      const v = validateInput(body, false);
      if (!v.ok) return badRequest(v.error);

      /* code 변경 시 중복 체크 */
      if (v.data.code && v.data.code !== existing.code) {
        const [dup] = await db
          .select({ id: resourceCategories.id })
          .from(resourceCategories)
          .where(eq(resourceCategories.code, v.data.code))
          .limit(1);
        if (dup) return badRequest("이미 사용 중인 code입니다");
      }

      const [updated] = await db
        .update(resourceCategories)
        .set({ ...v.data, updatedAt: new Date() } as any)
        .where(eq(resourceCategories.id, id))
        .returning();

      try {
        await logAdminAction(req, admin.uid, admin.name, "resource_category_update", {
          target: `RC-${id}`,
          detail: { changedFields: Object.keys(v.data) },
        });
      } catch (_) {}

      return ok({ category: updated }, "카테고리가 수정되었습니다");
    }

    /* ===== DELETE ===== */
    if (req.method === "DELETE") {
      if (!canEdit(adminMember)) return forbidden("카테고리 삭제 권한이 없습니다");

      const url = new URL(req.url);
      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const [existing] = await db
        .select()
        .from(resourceCategories)
        .where(eq(resourceCategories.id, id))
        .limit(1);
      if (!existing) return notFound("카테고리를 찾을 수 없습니다");

      /* 연결된 자료 카운트 */
      const cntRow: any = await db
        .select({ c: sql<number>`COUNT(*)::int` })
        .from(resources)
        .where(eq(resources.categoryId, id));
      const linkedCount = Number(cntRow[0]?.c ?? 0);

      /* schema에 onDelete: "set null" 명시되어 있어 DB가 자동 처리 ✅ */
      await db.delete(resourceCategories).where(eq(resourceCategories.id, id));

      try {
        await logAdminAction(req, admin.uid, admin.name, "resource_category_delete", {
          target: `RC-${id}`,
          detail: { code: existing.code, nameKo: existing.nameKo, linkedResources: linkedCount },
        });
      } catch (_) {}

      return ok({
        deletedId: id,
        linkedResources: linkedCount,
      }, `카테고리가 삭제되었습니다${linkedCount > 0 ? ` (연결된 ${linkedCount}개 자료는 카테고리 연결이 해제됨)` : ""}`);
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-resource-categories]", err);
    return serverError("카테고리 처리 중 오류", err?.message);
  }
};

export const config = { path: "/api/admin/resource-categories" };