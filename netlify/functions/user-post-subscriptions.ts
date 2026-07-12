// user-post-subscriptions.ts — 내 구독 목록 조회
// GET /api/user-post-subscriptions
import { jsonKST } from "../../lib/kst";
import { requireActiveUser } from "../../lib/auth";
import { db } from "../../db";
import { postSubscriptions, boardPosts } from "../../db/schema";
import { eq, inArray } from "drizzle-orm";

export const config = { path: "/api/user-post-subscriptions" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "구독 목록 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "허용되지 않는 메서드" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  let auth: any;
  try {
    auth = await requireActiveUser(req);
  } catch (err) {
    return jsonError("auth", err);
  }
  if (!auth.ok) return auth.res;

  const memberId = auth.user.uid as number;

  // 전체 구독 행 조회
  let allSubs: any[] = [];
  try {
    allSubs = await db
      .select({
        id: postSubscriptions.id,
        postId: postSubscriptions.postId,
        boardCategory: postSubscriptions.boardCategory,
        createdAt: postSubscriptions.createdAt,
      })
      .from(postSubscriptions)
      .where(eq(postSubscriptions.memberId, memberId))
      .limit(300);
  } catch (err) {
    return jsonError("select_subs", err);
  }

  const boardSubs = allSubs.filter((r) => r.boardCategory != null && r.postId == null);
  const postSubRows = allSubs.filter((r) => r.postId != null);

  // 게시글 제목 보강
  const postIds = [...new Set(postSubRows.map((r) => r.postId as number))];
  const postMap = new Map<number, string>();
  if (postIds.length > 0) {
    try {
      const posts = await db
        .select({ id: boardPosts.id, title: boardPosts.title })
        .from(boardPosts)
        .where(inArray(boardPosts.id, postIds));
      posts.forEach((p) => postMap.set(p.id, p.title));
    } catch (err) {
      console.warn("[user-post-subscriptions] post title 조회 실패", err);
    }
  }

  return new Response(jsonKST({
    ok: true,
    boardSubscriptions: boardSubs,
    postSubscriptions: postSubRows.map((r) => ({
      id: r.id,
      postId: r.postId,
      postTitle: postMap.get(r.postId as number) || "",
      createdAt: r.createdAt,
    })),
  }), { headers: { "Content-Type": "application/json" } });
};
