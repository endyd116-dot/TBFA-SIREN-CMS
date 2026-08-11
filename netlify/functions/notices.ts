/**
 * GET /api/notices         → 목록 (페이징, 카테고리 필터)
 * GET /api/notices?id=N    → 상세 (조회수 +1)
 */
import { eq, asc, desc, and, sql, count } from "drizzle-orm";
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
        .set({ views: sql`${notices.views} + 1` } as any)
        .where(eq(notices.id, noticeId))
        .catch(() => {});

      return ok({ notice: item });
    }

    /* ===== 목록 조회 ===== */
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(50, Number(url.searchParams.get("limit") || 10));
    const category = url.searchParams.get("category"); // general/member/event/media

    /* 분류는 운영자가 만들고 지우므로 고정 목록으로 막지 않는다.
       주소로 들어오는 값이라 형태만 확인하고 그대로 조건에 쓴다. */
    const conditions = [eq(notices.isPublished, true)];
    if (category && /^[a-z0-9_-]{1,30}$/i.test(category)) {
      conditions.push(eq(notices.category, category));
    }
    const where = conditions.length === 1 ? conditions[0] : and(...conditions);

    /* 총 개수 */
    const [{ total }] = await db
      .select({ total: count() })
      .from(notices)
      .where(where);

    /* 목록 — 운영자가 정한 표시 순서(작을수록 위)가 기준.
       순서를 아직 안 정한 글(0)은 뒤로 밀리지 않도록 최신순으로 이어 붙인다. */
    const rows = await db
      .select({
        id: notices.id,
        category: notices.category,
        title: notices.title,
        excerpt: notices.excerpt,
        authorName: notices.authorName,
        isPinned: notices.isPinned,
        sortOrder: notices.sortOrder,
        views: notices.views,
        publishedAt: notices.publishedAt,
        createdAt: notices.createdAt,
      })
      .from(notices)
      .where(where)
      .orderBy(
        sql`CASE WHEN ${notices.sortOrder} = 0 THEN 1 ELSE 0 END`,
        asc(notices.sortOrder),
        desc(notices.publishedAt),
        desc(notices.id),
      )
      .limit(limit)
      .offset((page - 1) * limit);

    /* 화면에 보이는 자리 그대로 1, 2, 3 … 을 매긴다.
       DB 내부 번호(5, 10 …)를 그대로 보여주면 목록이 띄엄띄엄해 보인다. */
    const startNo = (page - 1) * limit;
    const list = rows.map((r, i) => ({ ...r, displayNo: startNo + i + 1 }));

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