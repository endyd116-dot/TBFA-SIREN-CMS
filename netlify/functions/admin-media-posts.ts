// netlify/functions/admin-media-posts.ts
// ★ M-11: 언론보도/갤러리 CRUD (어드민)

import { eq, and, desc, count, or, like } from "drizzle-orm";
import { db } from "../../db";
import { mediaPosts } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, created, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin/media-posts" };

const VALID_CATEGORIES = ["press", "photo", "event"];

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member: adminMember } = guard.ctx;

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");

      if (id) {
        const itemId = Number(id);
        if (!Number.isFinite(itemId)) return badRequest("id 유효하지 않음");
        const [item] = await db.select().from(mediaPosts)
          .where(eq(mediaPosts.id, itemId)).limit(1);
        if (!item) return notFound("게시글을 찾을 수 없습니다");
        return ok({ post: item });
      }

      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));
      const category = url.searchParams.get("category") || "";
      const published = url.searchParams.get("published") || "";
      const q = String(url.searchParams.get("q") || "").trim().slice(0, 100);

      const conds: any[] = [];
      if (VALID_CATEGORIES.includes(category)) conds.push(eq(mediaPosts.category, category as any));
      if (published === "true") conds.push(eq(mediaPosts.isPublished, true));
      else if (published === "false") conds.push(eq(mediaPosts.isPublished, false));
      if (q && q.length >= 2) {
        conds.push(or(like(mediaPosts.title, `%${q}%`), like(mediaPosts.source, `%${q}%`)));
      }
      const where = conds.length === 0 ? undefined : (conds.length === 1 ? conds[0] : and(...conds));

      const [{ total }]: any = await db.select({ total: count() }).from(mediaPosts).where(where as any);

      const list = await db.select().from(mediaPosts)
        .where(where as any)
        .orderBy(desc(mediaPosts.publishedAt), desc(mediaPosts.createdAt))
        .limit(limit).offset((page - 1) * limit);

      return ok({
        list,
        pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
      });
    }

    if (req.method === "POST") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const title = String(body.title || "").trim().slice(0, 200);
      const category = VALID_CATEGORIES.includes(body.category) ? body.category : "press";
      const summary = String(body.summary || "").trim().slice(0, 500);
      const contentHtml = String(body.contentHtml || "");
      const thumbnailBlobId = body.thumbnailBlobId ? Number(body.thumbnailBlobId) : null;
      const externalUrl = String(body.externalUrl || "").trim().slice(0, 500);
      const source = String(body.source || "").trim().slice(0, 100);
      const isPublished = body.isPublished !== false;
      const publishedAtRaw = body.publishedAt ? new Date(body.publishedAt) : null;
      const publishedAt = (publishedAtRaw && !isNaN(publishedAtRaw.getTime())) ? publishedAtRaw : new Date();

      if (!title) return badRequest("제목은 필수입니다");

      const insertData: any = {
        category, title, summary: summary || null, contentHtml: contentHtml || null,
        thumbnailBlobId, externalUrl: externalUrl || null, source: source || null,
        isPublished, publishedAt, updatedBy: adminMember.id,
      };

      const [row] = await db.insert(mediaPosts).values(insertData).returning();

      try {
        await logAdminAction(req, admin.uid, admin.name, "media_post_create", {
          target: `M-${(row as any).id}`, detail: { title, category, source },
        });
      } catch (_) {}

      return created({ post: row }, "게시글이 등록되었습니다");
    }

    if (req.method === "PATCH") {
      const body: any = await parseJson(req);
      if (!body?.id) return badRequest("id 필요");

      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("id 유효하지 않음");

      const [existing] = await db.select().from(mediaPosts).where(eq(mediaPosts.id, id)).limit(1);
      if (!existing) return notFound("게시글을 찾을 수 없습니다");

      const updateData: any = { updatedAt: new Date(), updatedBy: adminMember.id };
      if (body.title !== undefined) updateData.title = String(body.title).trim().slice(0, 200);
      if (body.summary !== undefined) updateData.summary = String(body.summary).trim().slice(0, 500) || null;
      if (body.contentHtml !== undefined) updateData.contentHtml = String(body.contentHtml) || null;
      if (body.category !== undefined && VALID_CATEGORIES.includes(body.category)) updateData.category = body.category;
      if (body.thumbnailBlobId !== undefined) {
        updateData.thumbnailBlobId = body.thumbnailBlobId === null ? null : Number(body.thumbnailBlobId);
      }
      if (body.externalUrl !== undefined) updateData.externalUrl = String(body.externalUrl).trim().slice(0, 500) || null;
      if (body.source !== undefined) updateData.source = String(body.source).trim().slice(0, 100) || null;
      if (body.isPublished !== undefined) {
        updateData.isPublished = body.isPublished !== false;
        if ((existing as any).isPublished === false && updateData.isPublished === true) {
          updateData.publishedAt = new Date();
        }
      }
      if (body.publishedAt !== undefined) {
        const d = new Date(body.publishedAt);
        if (!isNaN(d.getTime())) updateData.publishedAt = d;
      }

      await db.update(mediaPosts).set(updateData).where(eq(mediaPosts.id, id));

      try {
        await logAdminAction(req, admin.uid, admin.name, "media_post_update", {
          target: `M-${id}`,
        });
      } catch (_) {}

      return ok({ id }, "수정되었습니다");
    }

    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id)) return badRequest("id 필요");

      const [existing] = await db.select({ id: mediaPosts.id, title: mediaPosts.title })
        .from(mediaPosts).where(eq(mediaPosts.id, id)).limit(1);
      if (!existing) return notFound("게시글을 찾을 수 없습니다");

      await db.delete(mediaPosts).where(eq(mediaPosts.id, id));

      try {
        await logAdminAction(req, admin.uid, admin.name, "media_post_delete", {
          target: `M-${id}`, detail: { title: existing.title },
        });
      } catch (_) {}

      return ok({ id }, "삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-media-posts]", e);
    return serverError("처리 실패", e);
  }
};