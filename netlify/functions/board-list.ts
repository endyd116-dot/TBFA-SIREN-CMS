// netlify/functions/board-list.ts
// ★ Phase M-8: 게시글 목록 (페이징 + 카테고리 + 검색)
// - 공개 GET (로그인 불필요)

import type { Context } from "@netlify/functions";
import { eq, and, desc, sql as sqlExp, count, or, like } from "drizzle-orm";
import { db } from "../../db";
import { boardPosts } from "../../db/schema";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/board/list" };

const VALID_CATEGORIES = ["general", "share", "question", "info", "etc"];

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(50, Math.max(5, Number(url.searchParams.get("limit") || 20)));
    const category = url.searchParams.get("category") || "";
    const q = String(url.searchParams.get("q") || "").trim().slice(0, 100);

    const conds: any[] = [eq(boardPosts.isHidden, false)];
    if (VALID_CATEGORIES.includes(category)) {
      conds.push(eq(boardPosts.category, category as any));
    }
    if (q) {
      conds.push(or(
        like(boardPosts.title, `%${q}%`),
        like(boardPosts.contentHtml, `%${q}%`),
      ));
    }
    const where = conds.length === 1 ? conds[0] : and(...conds);

    const [{ total }]: any = await db.select({ total: count() }).from(boardPosts).where(where);

    const list = await db.select({
      id: boardPosts.id,
      postNo: boardPosts.postNo,
      category: boardPosts.category,
      title: boardPosts.title,
      authorName: boardPosts.authorName,
      isAnonymous: boardPosts.isAnonymous,
      isPinned: boardPosts.isPinned,
      views: boardPosts.views,
      likeCount: boardPosts.likeCount,
      commentCount: boardPosts.commentCount,
      createdAt: boardPosts.createdAt,
    })
      .from(boardPosts)
      .where(where)
      .orderBy(desc(boardPosts.isPinned), desc(boardPosts.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return ok({
      list,
      pagination: {
        page, limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit),
      },
    });
  } catch (e: any) {
    console.error("[board-list]", e);
    return serverError("목록 조회 실패", e);
  }
};