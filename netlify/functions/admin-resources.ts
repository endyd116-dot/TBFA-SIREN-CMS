// netlify/functions/admin-resources.ts
// ★ Phase M-19-8: 자료실 자료 CRUD (어드민)
//
// GET    /api/admin/resources                        — 목록 (페이지네이션 + 필터 + 통계)
// GET    /api/admin/resources?id=N                   — 단건 상세 (작성자/카테고리 조인)
// POST   /api/admin/resources                        — 신규 생성
// PATCH  /api/admin/resources                        — 수정 (body: { id, ...fields })
// DELETE /api/admin/resources?id=N                   — 삭제
//
// 권한:
//  - GET: 모든 운영자 (목록 조회)
//  - POST/PATCH/DELETE: super_admin 또는 'all' 카테고리 담당자

import { eq, and, desc, sql, or, like } from "drizzle-orm";
import { db } from "../../db";
import { resources, resourceCategories, members, blobUploads } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

const VALID_ACCESS_LEVELS = ["public", "members_only", "private"];

/* ───────── 권한 체크 ───────── */
function canEdit(adminMember: any): boolean {
  if (!adminMember) return false;
  if (adminMember.role === "super_admin") return true;
  const cats: string[] = Array.isArray(adminMember.assignedCategories)
    ? adminMember.assignedCategories
    : [];
  return cats.includes("all");
}

/* ───────── slug 정규화 ───────── */
function normalizeSlug(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

/* ───────── 입력 검증 ───────── */
function validateInput(
  body: any,
  isCreate: boolean
): { ok: true; data: any } | { ok: false; error: string } {
  const data: any = {};

  if (isCreate || body.title !== undefined) {
    const t = String(body.title || "").trim();
    if (!t) return { ok: false, error: "제목은 필수입니다" };
    if (t.length > 200) return { ok: false, error: "제목은 200자를 초과할 수 없습니다" };
    data.title = t;
  }

  if (isCreate || body.slug !== undefined) {
    /* slug는 선택 사항 — 비어있으면 자동 생성 */
    if (body.slug !== null && body.slug !== "") {
      const s = normalizeSlug(body.slug || body.title || "");
      if (s && s.length < 3) return { ok: false, error: "slug는 3자 이상이어야 합니다" };
      data.slug = s || null;
    } else if (body.slug === null) {
      data.slug = null;
    }
  }

  if (body.categoryId !== undefined) {
    if (body.categoryId === null) {
      data.categoryId = null;
    } else {
      const n = Number(body.categoryId);
      if (!Number.isInteger(n) || n < 1) return { ok: false, error: "categoryId는 양의 정수여야 합니다" };
      data.categoryId = n;
    }
  }

  if (body.description !== undefined) {
    data.description = body.description === null ? null : String(body.description).slice(0, 5000);
  }

  if (body.contentHtml !== undefined) {
    data.contentHtml = body.contentHtml === null ? null : String(body.contentHtml).slice(0, 100000);
  }

  if (body.fileBlobId !== undefined) {
    if (body.fileBlobId === null) {
      data.fileBlobId = null;
    } else {
      const n = Number(body.fileBlobId);
      if (!Number.isInteger(n) || n < 1) return { ok: false, error: "fileBlobId는 양의 정수여야 합니다" };
      data.fileBlobId = n;
    }
  }

  if (body.thumbnailBlobId !== undefined) {
    if (body.thumbnailBlobId === null) {
      data.thumbnailBlobId = null;
    } else {
      const n = Number(body.thumbnailBlobId);
      if (!Number.isInteger(n) || n < 1) return { ok: false, error: "thumbnailBlobId는 양의 정수여야 합니다" };
      data.thumbnailBlobId = n;
    }
  }

  if (body.accessLevel !== undefined) {
    if (!VALID_ACCESS_LEVELS.includes(body.accessLevel)) {
      return { ok: false, error: "accessLevel은 public/members_only/private 중 하나여야 합니다" };
    }
    data.accessLevel = body.accessLevel;
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) {
      return { ok: false, error: "tags는 배열이어야 합니다" };
    }
    const cleaned = body.tags
      .filter((t: any) => typeof t === "string")
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 0 && t.length <= 30)
      .slice(0, 10);
    data.tags = cleaned;
  }

  if (body.isPublished !== undefined) data.isPublished = !!body.isPublished;
  if (body.isPinned !== undefined) data.isPinned = !!body.isPinned;

  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isFinite(n)) return { ok: false, error: "sortOrder는 숫자여야 합니다" };
    data.sortOrder = Math.max(0, Math.min(9999, Math.floor(n)));
  }

  if (body.publishedAt !== undefined) {
    if (body.publishedAt === null || body.publishedAt === "") {
      data.publishedAt = null;
    } else {
      const d = new Date(body.publishedAt);
      if (isNaN(d.getTime())) return { ok: false, error: "publishedAt 형식이 잘못되었습니다" };
      data.publishedAt = d;
    }
  }

  return { ok: true, data };
}

/* ───────── slug 자동 생성 (충돌 시 -2, -3 ...) ───────── */
async function ensureUniqueSlug(baseSlug: string, excludeId?: number): Promise<string> {
  let slug = baseSlug;
  let counter = 2;
  while (true) {
    const conds: any[] = [eq(resources.slug, slug)];
    if (excludeId) conds.push(sql`${resources.id} <> ${excludeId}`);
    const [dup] = await db
      .select({ id: resources.id })
      .from(resources)
      .where(and(...conds))
      .limit(1);
    if (!dup) return slug;
    slug = `${baseSlug}-${counter}`;
    counter++;
    if (counter > 100) throw new Error("slug 생성 실패 (100회 시도)");
  }
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
          .from(resources)
          .where(eq(resources.id, id))
          .limit(1);
        if (!row) return notFound("자료를 찾을 수 없습니다");

        /* 카테고리 정보 조인 */
        let category: any = null;
        if (row.categoryId) {
          const [c] = await db
            .select()
            .from(resourceCategories)
            .where(eq(resourceCategories.id, row.categoryId))
            .limit(1);
          category = c || null;
        }

        /* 작성자/수정자 정보 */
        let creator: any = null;
        let updater: any = null;
        if ((row as any).createdBy) {
          const [c] = await db
            .select({ id: members.id, name: members.name, email: members.email })
            .from(members)
            .where(eq(members.id, (row as any).createdBy))
            .limit(1);
          creator = c || null;
        }
        if ((row as any).updatedBy) {
          const [u] = await db
            .select({ id: members.id, name: members.name })
            .from(members)
            .where(eq(members.id, (row as any).updatedBy))
            .limit(1);
          updater = u || null;
        }

        /* 파일 정보 */
        let fileBlob: any = null;
        let thumbnailBlob: any = null;
        if (row.fileBlobId) {
          const [b] = await db
            .select({
              id: blobUploads.id,
              blobKey: blobUploads.blobKey,
              originalName: blobUploads.originalName,
              mimeType: blobUploads.mimeType,
              sizeBytes: blobUploads.sizeBytes,
            })
            .from(blobUploads)
            .where(eq(blobUploads.id, row.fileBlobId))
            .limit(1);
          fileBlob = b || null;
        }
        if (row.thumbnailBlobId) {
          const [b] = await db
            .select({
              id: blobUploads.id,
              blobKey: blobUploads.blobKey,
              mimeType: blobUploads.mimeType,
            })
            .from(blobUploads)
            .where(eq(blobUploads.id, row.thumbnailBlobId))
            .limit(1);
          thumbnailBlob = b || null;
        }

        return ok({
          resource: row,
          category,
          creator,
          updater,
          fileBlob,
          thumbnailBlob,
        });
      }

      /* ── 목록 ── */
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));
      const categoryId = url.searchParams.get("categoryId");
      const accessLevel = url.searchParams.get("accessLevel") || "";
      const published = url.searchParams.get("published") || "";
      const tag = (url.searchParams.get("tag") || "").trim();
      const q = (url.searchParams.get("q") || "").trim().slice(0, 100);

      const conds: any[] = [];
      if (categoryId) {
        const cn = Number(categoryId);
        if (Number.isFinite(cn)) conds.push(eq(resources.categoryId, cn));
      }
      if (VALID_ACCESS_LEVELS.includes(accessLevel)) {
        conds.push(eq(resources.accessLevel, accessLevel as any));
      }
      if (published === "true") conds.push(eq(resources.isPublished, true));
      else if (published === "false") conds.push(eq(resources.isPublished, false));
      if (tag) {
        conds.push(sql`${resources.tags} @> ${JSON.stringify([tag])}::jsonb`);
      }
      if (q && q.length >= 2) {
        conds.push(or(
          like(resources.title, `%${q}%`),
          like(resources.description, `%${q}%`),
        ));
      }
      const where = conds.length === 0 ? undefined : (conds.length === 1 ? conds[0] : and(...conds));

      const totalRow: any = await db
        .select({ c: sql<number>`COUNT(*)::int` })
        .from(resources)
        .where(where as any);
      const total = Number(totalRow[0]?.c ?? 0);

      const list = await db
        .select({
          id: resources.id,
          categoryId: resources.categoryId,
          title: resources.title,
          slug: resources.slug,
          description: resources.description,
          fileBlobId: resources.fileBlobId,
          thumbnailBlobId: resources.thumbnailBlobId,
          accessLevel: resources.accessLevel,
          tags: resources.tags,
          downloadCount: resources.downloadCount,
          views: resources.views,
          isPublished: resources.isPublished,
          isPinned: resources.isPinned,
          sortOrder: resources.sortOrder,
          publishedAt: resources.publishedAt,
          createdAt: resources.createdAt,
          updatedAt: resources.updatedAt,
        })
        .from(resources)
        .where(where as any)
        .orderBy(desc(resources.isPinned), desc(resources.publishedAt), desc(resources.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      /* 카테고리명 일괄 조회 */
      const catIds = list
        .map((r: any) => r.categoryId)
        .filter((v: any) => v != null);
      const catMap: Record<string, any> = {};
      if (catIds.length > 0) {
        const cats = await db
          .select({
            id: resourceCategories.id,
            code: resourceCategories.code,
            nameKo: resourceCategories.nameKo,
            icon: resourceCategories.icon,
          })
          .from(resourceCategories)
          .where(sql`${resourceCategories.id} = ANY(${catIds})`);
        for (const c of cats) catMap[String(c.id)] = c;
      }

      const enriched = list.map((r: any) => ({
        ...r,
        category: r.categoryId ? (catMap[String(r.categoryId)] || null) : null,
      }));

      /* 통계 */
      const statsRow: any = await db.execute(sql`
        SELECT
          COUNT(*)::int AS "totalCount",
          COUNT(*) FILTER (WHERE is_published = true)::int AS "publishedCount",
          COUNT(*) FILTER (WHERE is_published = false)::int AS "draftCount",
          COUNT(*) FILTER (WHERE access_level = 'public')::int AS "publicCount",
          COUNT(*) FILTER (WHERE access_level = 'members_only')::int AS "membersOnlyCount",
          COUNT(*) FILTER (WHERE access_level = 'private')::int AS "privateCount",
          COALESCE(SUM(download_count), 0)::int AS "totalDownloads",
          COALESCE(SUM(views), 0)::int AS "totalViews"
        FROM resources
      `);
      const s: any = (statsRow.rows || statsRow || [{}])[0];

      return ok({
        list: enriched,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        stats: {
          total: Number(s.totalCount || 0),
          published: Number(s.publishedCount || 0),
          draft: Number(s.draftCount || 0),
          public: Number(s.publicCount || 0),
          membersOnly: Number(s.membersOnlyCount || 0),
          private: Number(s.privateCount || 0),
          totalDownloads: Number(s.totalDownloads || 0),
          totalViews: Number(s.totalViews || 0),
        },
      });
    }

    /* ===== POST: 신규 생성 ===== */
    if (req.method === "POST") {
      if (!canEdit(adminMember)) {
        return forbidden("자료 생성 권한이 없습니다 (super_admin 또는 'all' 담당자만 가능)");
      }

      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const v = validateInput(body, true);
      if (!v.ok) return badRequest(v.error);

      /* 카테고리 존재 확인 */
      if (v.data.categoryId) {
        const [c] = await db
          .select({ id: resourceCategories.id })
          .from(resourceCategories)
          .where(eq(resourceCategories.id, v.data.categoryId))
          .limit(1);
        if (!c) return badRequest("존재하지 않는 카테고리입니다");
      }

      /* slug 자동 생성 (없으면 title에서) */
      let finalSlug = v.data.slug;
      if (!finalSlug) {
        const baseSlug = normalizeSlug(v.data.title);
        if (baseSlug && baseSlug.length >= 3) {
          finalSlug = await ensureUniqueSlug(baseSlug);
        }
      } else {
        /* 명시 slug 중복 체크 */
        const [dup] = await db
          .select({ id: resources.id })
          .from(resources)
          .where(eq(resources.slug, finalSlug))
          .limit(1);
        if (dup) return badRequest("이미 사용 중인 slug입니다");
      }

      const insertData: any = {
        ...v.data,
        slug: finalSlug || null,
        accessLevel: v.data.accessLevel || "public",
        publishedAt: v.data.publishedAt !== undefined ? v.data.publishedAt : new Date(),
        createdBy: admin.uid,
        updatedBy: admin.uid,
      };

      const [created] = await db.insert(resources).values(insertData).returning();

      /* blob_uploads의 reference 갱신 (file/thumbnail) */
      if (created.fileBlobId) {
        try {
          await db.update(blobUploads).set({
            referenceTable: "resources",
            referenceId: created.id,
          } as any).where(eq(blobUploads.id, created.fileBlobId));
        } catch (_) {}
      }
      if (created.thumbnailBlobId) {
        try {
          await db.update(blobUploads).set({
            referenceTable: "resources",
            referenceId: created.id,
          } as any).where(eq(blobUploads.id, created.thumbnailBlobId));
        } catch (_) {}
      }

      try {
        await logAdminAction(req, admin.uid, admin.name, "resource_create", {
          target: `R-${created.id}`,
          detail: {
            title: created.title,
            slug: created.slug,
            accessLevel: created.accessLevel,
            categoryId: created.categoryId,
          },
        });
      } catch (_) {}

      return ok({ resource: created }, "자료가 생성되었습니다");
    }

    /* ===== PATCH: 수정 ===== */
    if (req.method === "PATCH") {
      if (!canEdit(adminMember)) return forbidden("자료 수정 권한이 없습니다");

      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const [existing] = await db.select().from(resources).where(eq(resources.id, id)).limit(1);
      if (!existing) return notFound("자료를 찾을 수 없습니다");

      const v = validateInput(body, false);
      if (!v.ok) return badRequest(v.error);

      /* 카테고리 변경 시 존재 확인 */
      if (v.data.categoryId) {
        const [c] = await db
          .select({ id: resourceCategories.id })
          .from(resourceCategories)
          .where(eq(resourceCategories.id, v.data.categoryId))
          .limit(1);
        if (!c) return badRequest("존재하지 않는 카테고리입니다");
      }

      /* slug 변경 시 중복 체크 */
      if (v.data.slug && v.data.slug !== existing.slug) {
        const [dup] = await db
          .select({ id: resources.id })
          .from(resources)
          .where(and(eq(resources.slug, v.data.slug), sql`${resources.id} <> ${id}`))
          .limit(1);
        if (dup) return badRequest("이미 사용 중인 slug입니다");
      }

      const updateData: any = {
        ...v.data,
        updatedBy: admin.uid,
        updatedAt: new Date(),
      };

      const [updated] = await db
        .update(resources)
        .set(updateData)
        .where(eq(resources.id, id))
        .returning();

      /* blob_uploads의 reference 갱신 */
      if (v.data.fileBlobId !== undefined && v.data.fileBlobId) {
        try {
          await db.update(blobUploads).set({
            referenceTable: "resources",
            referenceId: id,
          } as any).where(eq(blobUploads.id, v.data.fileBlobId));
        } catch (_) {}
      }
      if (v.data.thumbnailBlobId !== undefined && v.data.thumbnailBlobId) {
        try {
          await db.update(blobUploads).set({
            referenceTable: "resources",
            referenceId: id,
          } as any).where(eq(blobUploads.id, v.data.thumbnailBlobId));
        } catch (_) {}
      }

      try {
        await logAdminAction(req, admin.uid, admin.name, "resource_update", {
          target: `R-${id}`,
          detail: { changedFields: Object.keys(v.data) },
        });
      } catch (_) {}

      return ok({ resource: updated }, "자료가 수정되었습니다");
    }

    /* ===== DELETE ===== */
    if (req.method === "DELETE") {
      if (!canEdit(adminMember)) return forbidden("자료 삭제 권한이 없습니다");

      const url = new URL(req.url);
      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const [existing] = await db.select().from(resources).where(eq(resources.id, id)).limit(1);
      if (!existing) return notFound("자료를 찾을 수 없습니다");

      /* 자료 삭제 (파일 자체는 R2에 보존 — cron-cleanup에서 미참조 7일 후 정리) */
      await db.delete(resources).where(eq(resources.id, id));

      /* blob_uploads의 reference 해제 */
      if (existing.fileBlobId) {
        try {
          await db.update(blobUploads).set({
            referenceTable: null,
            referenceId: null,
          } as any).where(eq(blobUploads.id, existing.fileBlobId));
        } catch (_) {}
      }
      if (existing.thumbnailBlobId) {
        try {
          await db.update(blobUploads).set({
            referenceTable: null,
            referenceId: null,
          } as any).where(eq(blobUploads.id, existing.thumbnailBlobId));
        } catch (_) {}
      }

      try {
        await logAdminAction(req, admin.uid, admin.name, "resource_delete", {
          target: `R-${id}`,
          detail: {
            title: existing.title,
            slug: existing.slug,
            fileBlobId: existing.fileBlobId,
            downloadCount: existing.downloadCount,
          },
        });
      } catch (_) {}

      return ok({ deletedId: id }, "자료가 삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-resources]", err);
    return serverError("자료 처리 중 오류", err?.message);
  }
};

export const config = { path: "/api/admin/resources" };