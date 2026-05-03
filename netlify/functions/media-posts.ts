// netlify/functions/media-posts.ts
// ★ M-11: 언론보도/갤러리 공개 조회

import { eq, and, desc, count, sql as sqlExp } from "drizzle-orm";
import { db } from "../../db";
import { mediaPosts } from "../../db/schema";
import {
  ok, badRequest, notFound, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/media-posts" };

const VALID_CATEGORIES = ["press", "photo", "event"];

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    /* 상세 */
    if (id) {
      const itemId = Number(id);
      if (!Number.isFinite(itemId)) return badRequest("id 유효하지 않음");

      const [item] = await db.select().from(mediaPosts)
        .where(and(eq(mediaPosts.id, itemId), eq(mediaPosts.isPublished, true)))
        .limit(1);
      if (!item) return notFound("게시글을 찾을 수 없습니다");

      db.update(mediaPosts)
        .set({ views: sqlExp`${mediaPosts.views} + 1` as any })
        .where(eq(mediaPosts.id, itemId))
        .catch(() => {});

      const r: any = item;
      return ok({
        post: {
          id: r.id, category: r.category,
          title: r.title, summary: r.summary, contentHtml: r.contentHtml,
          source: r.source, externalUrl: r.externalUrl,
          thumbnailUrl: r.thumbnailBlobId ? `/api/blob-image?id=${r.thumbnailBlobId}` : null,
          views: (r.views || 0) + 1,
          publishedAt: r.publishedAt, createdAt: r.createdAt,
        },
      });
    }

    /* 목록 */
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(50, Math.max(8, Number(url.searchParams.get("limit") || 12)));
    const category = url.searchParams.get("category") || "";

    const conds: any[] = [eq(mediaPosts.isPublished, true)];
    if (VALID_CATEGORIES.includes(category)) conds.push(eq(mediaPosts.category, category as any));
    const where = conds.length === 1 ? conds[0] : and(...conds);

    const [{ total }]: any = await db.select({ total: count() }).from(mediaPosts).where(where);

    const list = await db.select({
      id: mediaPosts.id,
      category: mediaPosts.category,
      title: mediaPosts.title,
      summary: mediaPosts.summary,
      thumbnailBlobId: mediaPosts.thumbnailBlobId,
      externalUrl: mediaPosts.externalUrl,
      source: mediaPosts.source,
      views: mediaPosts.views,
      publishedAt: mediaPosts.publishedAt,
    }).from(mediaPosts).where(where)
      .orderBy(desc(mediaPosts.publishedAt))
      .limit(limit).offset((page - 1) * limit);

    return ok({
      list: list.map((n: any) => ({
        ...n,
        thumbnailUrl: n.thumbnailBlobId ? `/api/blob-image?id=${n.thumbnailBlobId}` : null,
      })),
      pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
    });
  } catch (e: any) {
    console.error("[media-posts]", e);
    return serverError("조회 실패", e);
  }
};