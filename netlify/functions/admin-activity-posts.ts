// netlify/functions/admin-activity-posts.ts
// ★ M-11: 주요 활동 게시글 CRUD (어드민)

import { eq, and, desc, count, or, like } from "drizzle-orm";
import { db } from "../../db";
import { activityPosts } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, created, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin/activity-posts" };

const VALID_CATEGORIES = ["report", "photo", "news"];

function generateSlug(title: string, year: number): string {
  const ts = Date.now().toString().slice(-6);
  const safe = String(title || "").toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return `activity-${year}-${safe}-${ts}`;
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
      const id = url.searchParams.get("id");

      if (id) {
        const itemId = Number(id);
        if (!Number.isFinite(itemId)) return badRequest("id 유효하지 않음");

        const [item] = await db.select().from(activityPosts)
          .where(eq(activityPosts.id, itemId)).limit(1);
        if (!item) return notFound("게시글을 찾을 수 없습니다");

        return ok({ post: item });
      }

      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));
      const category = url.searchParams.get("category") || "";
      const year = url.searchParams.get("year") || "";
      const published = url.searchParams.get("published") || "";
      const q = String(url.searchParams.get("q") || "").trim().slice(0, 100);

      const conds: any[] = [];
      if (VALID_CATEGORIES.includes(category)) conds.push(eq(activityPosts.category, category as any));
      if (year && /^\d{4}$/.test(year)) conds.push(eq(activityPosts.year, Number(year)));
      if (published === "true") conds.push(eq(activityPosts.isPublished, true));
      else if (published === "false") conds.push(eq(activityPosts.isPublished, false));
      if (q && q.length >= 2) {
        conds.push(or(like(activityPosts.title, `%${q}%`), like(activityPosts.slug, `%${q}%`)));
      }
      const where = conds.length === 0 ? undefined : (conds.length === 1 ? conds[0] : and(...conds));

      const [{ total }]: any = await db.select({ total: count() }).from(activityPosts).where(where as any);

      const list = await db.select({
        id: activityPosts.id,
        slug: activityPosts.slug,
        year: activityPosts.year,
        month: activityPosts.month,
        category: activityPosts.category,
        title: activityPosts.title,
        summary: activityPosts.summary,
        thumbnailBlobId: activityPosts.thumbnailBlobId,
        isPublished: activityPosts.isPublished,
        isPinned: activityPosts.isPinned,
        sortOrder: activityPosts.sortOrder,
        views: activityPosts.views,
        publishedAt: activityPosts.publishedAt,
        createdAt: activityPosts.createdAt,
        updatedAt: activityPosts.updatedAt,
      }).from(activityPosts).where(where as any)
        .orderBy(desc(activityPosts.isPinned), desc(activityPosts.publishedAt), desc(activityPosts.createdAt))
        .limit(limit).offset((page - 1) * limit);

      return ok({
        list,
        pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
      });
    }

    /* ===== POST ===== */
    if (req.method === "POST") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const title = String(body.title || "").trim().slice(0, 200);
      const year = Number(body.year);
      const month = body.month ? Number(body.month) : null;
      const category = VALID_CATEGORIES.includes(body.category) ? body.category : "news";
      const summary = String(body.summary || "").trim().slice(0, 500);
      const contentHtml = String(body.contentHtml || "");
      const thumbnailBlobId = body.thumbnailBlobId ? Number(body.thumbnailBlobId) : null;
      const attachmentIds = Array.isArray(body.attachmentIds)
        ? body.attachmentIds.filter((x: any) => Number.isFinite(Number(x))).map(Number)
        : [];
      const isPublished = body.isPublished !== false;
      const isPinned = body.isPinned === true;
      const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;

      if (!title) return badRequest("제목은 필수입니다");
      if (!Number.isFinite(year) || year < 2000 || year > 2100) return badRequest("연도가 유효하지 않습니다");
      if (month !== null && (!Number.isFinite(month) || month < 1 || month > 12)) return badRequest("월이 유효하지 않습니다");

      const slug = body.slug
        ? String(body.slug).trim().slice(0, 100)
        : generateSlug(title, year);

      const [existingSlug] = await db.select({ id: activityPosts.id })
        .from(activityPosts).where(eq(activityPosts.slug, slug)).limit(1);
      if (existingSlug) return badRequest("이미 존재하는 slug입니다");

      const insertData: any = {
        slug, year, month, category, title, summary: summary || null,
        contentHtml: contentHtml || null,
        thumbnailBlobId, attachmentIds: attachmentIds.length ? JSON.stringify(attachmentIds) : null,
        isPublished, isPinned, sortOrder,
        publishedAt: isPublished ? new Date() : null,
        updatedBy: adminMember.id,
      };

      const [row] = await db.insert(activityPosts).values(insertData).returning();

      try {
        await logAdminAction(req, admin.uid, admin.name, "activity_post_create", {
          target: slug, detail: { title, category, year },
        });
      } catch (_) {}

      return created({ post: row }, "게시글이 등록되었습니다");
    }

    /* ===== PATCH ===== */
    if (req.method === "PATCH") {
      const body: any = await parseJson(req);
      if (!body?.id) return badRequest("id 필요");

      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("id 유효하지 않음");

      const [existing] = await db.select().from(activityPosts).where(eq(activityPosts.id, id)).limit(1);
      if (!existing) return notFound("게시글을 찾을 수 없습니다");

      const updateData: any = { updatedAt: new Date(), updatedBy: adminMember.id };

      if (body.title !== undefined) updateData.title = String(body.title).trim().slice(0, 200);
      if (body.summary !== undefined) updateData.summary = String(body.summary).trim().slice(0, 500) || null;
      if (body.contentHtml !== undefined) updateData.contentHtml = String(body.contentHtml) || null;
      if (body.year !== undefined) updateData.year = Number(body.year);
      if (body.month !== undefined) updateData.month = body.month === null ? null : Number(body.month);
      if (body.category !== undefined && VALID_CATEGORIES.includes(body.category)) updateData.category = body.category;
      if (body.thumbnailBlobId !== undefined) {
        updateData.thumbnailBlobId = body.thumbnailBlobId === null ? null : Number(body.thumbnailBlobId);
      }
      if (Array.isArray(body.attachmentIds)) {
        const ids = body.attachmentIds.filter((x: any) => Number.isFinite(Number(x))).map(Number);
        updateData.attachmentIds = ids.length ? JSON.stringify(ids) : null;
      }
      if (body.isPublished !== undefined) {
        updateData.isPublished = body.isPublished !== false;
        if ((existing as any).isPublished === false && updateData.isPublished === true) {
          updateData.publishedAt = new Date();
        }
      }
      if (body.isPinned !== undefined) updateData.isPinned = body.isPinned === true;
      if (body.sortOrder !== undefined) updateData.sortOrder = Number(body.sortOrder) || 0;

      await db.update(activityPosts).set(updateData).where(eq(activityPosts.id, id));

      try {
        await logAdminAction(req, admin.uid, admin.name, "activity_post_update", {
          target: (existing as any).slug,
        });
      } catch (_) {}

      return ok({ id, slug: (existing as any).slug }, "수정되었습니다");
    }

    /* ===== DELETE ===== */
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id)) return badRequest("id 필요");

      const [existing] = await db.select({ id: activityPosts.id, slug: activityPosts.slug, title: activityPosts.title })
        .from(activityPosts).where(eq(activityPosts.id, id)).limit(1);
      if (!existing) return notFound("게시글을 찾을 수 없습니다");

      await db.delete(activityPosts).where(eq(activityPosts.id, id));

      try {
        await logAdminAction(req, admin.uid, admin.name, "activity_post_delete", {
          target: existing.slug, detail: { title: existing.title },
        });
      } catch (_) {}

      return ok({ id }, "삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-activity-posts]", e);
    return serverError("처리 실패", e);
  }
};