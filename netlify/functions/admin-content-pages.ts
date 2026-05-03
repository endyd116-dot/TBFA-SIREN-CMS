// netlify/functions/admin-content-pages.ts
// ★ M-11: 협의회 소개 등 단일 페이지 콘텐츠 CRUD

import { eq, asc } from "drizzle-orm";
import { db } from "../../db";
import { contentPages } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin/content-pages" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member: adminMember } = guard.ctx;

  try {
    /* GET: 목록 또는 단건 (key 기준) */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const pageKey = url.searchParams.get("key");

      if (pageKey) {
        const [item] = await db.select().from(contentPages)
          .where(eq(contentPages.pageKey, pageKey)).limit(1);
        if (!item) return notFound("페이지를 찾을 수 없습니다");
        return ok({ page: item });
      }

      const list = await db.select({
        id: contentPages.id,
        pageKey: contentPages.pageKey,
        title: contentPages.title,
        updatedAt: contentPages.updatedAt,
        updatedBy: contentPages.updatedBy,
      }).from(contentPages).orderBy(asc(contentPages.pageKey));

      return ok({ list });
    }

    /* POST: 신규 키 생성 */
    if (req.method === "POST") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const pageKey = String(body.pageKey || "").trim().slice(0, 100);
      const title = String(body.title || "").trim().slice(0, 200);
      const contentHtml = String(body.contentHtml || "");

      if (!pageKey || !/^[a-z0-9_-]+$/i.test(pageKey)) {
        return badRequest("pageKey는 영문/숫자/언더스코어/하이픈만 가능합니다");
      }

      const [existing] = await db.select({ id: contentPages.id })
        .from(contentPages).where(eq(contentPages.pageKey, pageKey)).limit(1);
      if (existing) return badRequest("이미 존재하는 pageKey입니다");

      const [row] = await db.insert(contentPages).values({
        pageKey, title: title || null, contentHtml: contentHtml || null,
        updatedBy: adminMember.id,
      } as any).returning();

      try {
        await logAdminAction(req, admin.uid, admin.name, "content_page_create", {
          target: pageKey, detail: { title },
        });
      } catch (_) {}

      return ok({ page: row }, "페이지가 생성되었습니다");
    }

    /* PATCH: 수정 (id 또는 key 둘 다 허용) */
    if (req.method === "PATCH") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const id = body.id ? Number(body.id) : null;
      const pageKey = body.pageKey ? String(body.pageKey).trim() : null;
      if (!id && !pageKey) return badRequest("id 또는 pageKey 필요");

      const where = id ? eq(contentPages.id, id) : eq(contentPages.pageKey, pageKey!);
      const [existing] = await db.select().from(contentPages).where(where).limit(1);
      if (!existing) return notFound("페이지를 찾을 수 없습니다");

      const updateData: any = { updatedAt: new Date(), updatedBy: adminMember.id };
      if (body.title !== undefined) updateData.title = String(body.title).slice(0, 200) || null;
      if (body.contentHtml !== undefined) updateData.contentHtml = String(body.contentHtml) || null;

      await db.update(contentPages).set(updateData).where(where);

      try {
        await logAdminAction(req, admin.uid, admin.name, "content_page_update", {
          target: (existing as any).pageKey,
        });
      } catch (_) {}

      return ok({ id: (existing as any).id, pageKey: (existing as any).pageKey }, "저장되었습니다");
    }

    /* DELETE */
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id)) return badRequest("id 필요");

      const [existing] = await db.select({ id: contentPages.id, pageKey: contentPages.pageKey })
        .from(contentPages).where(eq(contentPages.id, id)).limit(1);
      if (!existing) return notFound("페이지를 찾을 수 없습니다");

      await db.delete(contentPages).where(eq(contentPages.id, id));

      try {
        await logAdminAction(req, admin.uid, admin.name, "content_page_delete", {
          target: existing.pageKey,
        });
      } catch (_) {}

      return ok({ id }, "삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-content-pages]", e);
    return serverError("처리 실패", e);
  }
};