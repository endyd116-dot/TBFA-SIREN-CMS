/**
 * GET /api/notices         → 목록 (페이징, 카테고리 필터)
 * GET /api/notices?id=N    → 상세 (조회수 +1)
 */
import { eq, desc, and, sql, count } from "drizzle-orm";
import { db, notices } from "../../db";
import {
  ok, badRequest, notFound, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    /* ===== 상세 조회 ===== */
    if (id) {
      const noticeId = Number(id);
      if (!Number.isFinite(noticeId)) return badRequest("유효하지 않은 ID");

      const [item] = await db
        .select()
        .from(notices)
        .where(and(eq(notices.id, noticeId), eq(notices.isPublished, true)))
        .limit(1);

      if (!item) return notFound("공지사항을 찾을 수 없습니다");

      /* 조회수 증가 (실패해도 무시) */
        db.update(notices)
        .set({ views: sql`${notices.views} + 1` as any })
        .where(eq(notices.id, noticeId))
        .catch(() => {});

      return ok({ notice: item });
    }

    /* ===== 목록 조회 ===== */
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(50, Number(url.searchParams.get("limit") || 10));
    const category = url.searchParams.get("category"); // general/member/event/media

    const conditions = [eq(notices.isPublished, true)];
    if (category && ["general", "member", "event", "media"].includes(category)) {
      conditions.push(eq(notices.category, category as any));
    }
    const where = conditions.length === 1 ? conditions[0] : and(...conditions);

    /* 총 개수 */
    const [{ total }] = await db
      .select({ total: count() })
      .from(notices)
      .where(where);

    /* 목록 (고정 우선) */
    const list = await db
      .select({
        id: notices.id,
        category: notices.category,
        title: notices.title,
        excerpt: notices.excerpt,
        authorName: notices.authorName,
        isPinned: notices.isPinned,
        views: notices.views,
        publishedAt: notices.publishedAt,
        createdAt: notices.createdAt,
      })
      .from(notices)
      .where(where)
      .orderBy(desc(notices.isPinned), desc(notices.publishedAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return ok({
      list,
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit),
      },
    });
  } catch (err) {
    console.error("[notices]", err);
    return serverError("공지사항 조회 중 오류", err);
  }
};

export const config = { path: "/api/notices" };