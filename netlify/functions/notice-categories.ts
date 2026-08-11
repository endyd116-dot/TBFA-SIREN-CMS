/**
 * GET /api/notice-categories — 공개용 공지 분류 목록 (켜져 있는 것만)
 *
 * 공지사항 화면의 분류 탭을 이 목록으로 그린다.
 * 운영자가 분류를 추가·삭제하면 화면 탭도 따라 바뀐다 (코드 수정 불필요).
 */
import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { noticeCategories } from "../../db/schema";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/notice-categories" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const list = await db
      .select({
        slug: noticeCategories.slug,
        label: noticeCategories.label,
        color: noticeCategories.color,
        sortOrder: noticeCategories.sortOrder,
      })
      .from(noticeCategories)
      .where(eq(noticeCategories.isActive, true))
      .orderBy(asc(noticeCategories.sortOrder), asc(noticeCategories.id));

    const res = ok({ list });
    res.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
    return res;
  } catch (err) {
    console.error("[notice-categories]", err);
    return serverError("공지 분류를 불러오지 못했습니다", err);
  }
};
