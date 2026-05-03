// netlify/functions/activity-posts.ts
// ★ M-11: 주요 활동 공개 조회 (목록 + 상세)

import { eq, and, desc, count, sql as sqlExp, inArray } from "drizzle-orm";
import { db } from "../../db";
import { activityPosts, blobUploads } from "../../db/schema";
import {
  ok, badRequest, notFound, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/activity-posts" };

const VALID_CATEGORIES = ["report", "photo", "news"];

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");

    /* 상세 (slug 기반) */
    if (slug) {
      const [item] = await db.select().from(activityPosts)
        .where(and(eq(activityPosts.slug, slug), eq(activityPosts.isPublished, true)))
        .limit(1);

      if (!item) return notFound("게시글을 찾을 수 없습니다");

      /* 조회수 +1 */
      db.update(activityPosts)
        .set({ views: sqlExp`${activityPosts.views} + 1` } as any)
        .where(eq(activityPosts.id, (item as any).id))
        .catch(() => {});

      /* 첨부파일 */
      const r: any = item;
      let attachments: any[] = [];
      if (r.attachmentIds) {
        try {
          const ids = JSON.parse(r.attachmentIds);
          if (Array.isArray(ids) && ids.length) {
            const files = await db.select().from(blobUploads).where(inArray(blobUploads.id, ids));
            attachments = files.map((f: any) => ({
              id: f.id, originalName: f.originalName, mimeType: f.mimeType,
              sizeBytes: f.sizeBytes, url: `/api/blob-image?id=${f.id}`,
            }));
          }
        } catch (_) {}
      }

      const thumbnailUrl = r.thumbnailBlobId ? `/api/blob-image?id=${r.thumbnailBlobId}` : null;

      return ok({
        post: {
          id: r.id, slug: r.slug, year: r.year, month: r.month, category: r.category,
          title: r.title, summary: r.summary, contentHtml: r.contentHtml,
          thumbnailUrl, attachments, views: (r.views || 0) + 1,
          publishedAt: r.publishedAt, createdAt: r.createdAt,
        },
      });
    }

    /* 목록 */
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(50, Math.max(8, Number(url.searchParams.get("limit") || 12)));
    const category = url.searchParams.get("category") || "";
    const year = url.searchParams.get("year") || "";

    const conds: any[] = [eq(activityPosts.isPublished, true)];
    if (VALID_CATEGORIES.includes(category)) conds.push(eq(activityPosts.category, category as any));
    if (year && /^\d{4}$/.test(year)) conds.push(eq(activityPosts.year, Number(year)));
    const where = conds.length === 1 ? conds[0] : and(...conds);

    const [{ total }]: any = await db.select({ total: count() }).from(activityPosts).where(where);

    const list = await db.select({
      id: activityPosts.id,
      slug: activityPosts.slug,
      year: activityPosts.year,
      month: activityPosts.month,
      category: activityPosts.category,
      title: activityPosts.title,
      summary: activityPosts.summary,
      thumbnailBlobId: activityPosts.thumbnailBlobId,
      isPinned: activityPosts.isPinned,
      views: activityPosts.views,
      publishedAt: activityPosts.publishedAt,
    }).from(activityPosts).where(where)
      .orderBy(desc(activityPosts.isPinned), desc(activityPosts.publishedAt))
      .limit(limit).offset((page - 1) * limit);

    /* 연도별 카운트 (필터 UI용) */
    const yearStats = await db.execute(sqlExp`
      SELECT year, COUNT(*)::int AS count
      FROM activity_posts
      WHERE is_published = TRUE
      GROUP BY year
      ORDER BY year DESC
    `);

    return ok({
      list: list.map((n: any) => ({
        ...n,
        thumbnailUrl: n.thumbnailBlobId ? `/api/blob-image?id=${n.thumbnailBlobId}` : null,
      })),
      pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
      yearStats,
    });
  } catch (e: any) {
    console.error("[activity-posts]", e);
    return serverError("조회 실패", e);
  }
};