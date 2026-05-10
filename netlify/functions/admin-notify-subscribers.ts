// admin-notify-subscribers.ts — 게시글 새 댓글 시 구독자 알림 발송
// POST /api/admin-notify-subscribers
// body: { postId, commentId, commentPreview, commentAuthorName }
// 게시글·댓글 API 내부에서 호출 (fire-and-forget 패턴)
import { requireActiveUser } from "../../lib/auth";
import { db } from "../../db";
import { postSubscriptions, boardPosts } from "../../db/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { createNotification } from "../../lib/notify";

export const config = { path: "/api/admin-notify-subscribers" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "구독자 알림 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "허용되지 않는 메서드" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  // 내부 호출이지만 인증은 유지 (사용자 본인 또는 관리자)
  let auth: any;
  try {
    auth = await requireActiveUser(req);
  } catch (err) {
    return jsonError("auth", err);
  }
  if (!auth.ok) return auth.res;

  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return jsonError("parse_body", err);
  }

  const postId = Number(body.postId);
  const commentId = Number(body.commentId);
  const commentPreview: string = String(body.commentPreview || "").slice(0, 100);
  const commentAuthorName: string = body.commentAuthorName || "누군가";

  if (!postId || !commentId) {
    return new Response(JSON.stringify({ ok: false, error: "postId, commentId 필요" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // 게시글 정보 조회
  let postRow: any;
  try {
    const rows = await db.select({ id: boardPosts.id, title: boardPosts.title, boardCategory: boardPosts.category })
      .from(boardPosts).where(eq(boardPosts.id, postId)).limit(1);
    postRow = rows[0];
  } catch (err) {
    return jsonError("select_post", err);
  }
  if (!postRow) {
    return new Response(JSON.stringify({ ok: false, error: "게시글 없음" }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }

  // 게시글 직접 구독자
  let postSubs: any[] = [];
  try {
    postSubs = await db.select({ memberId: postSubscriptions.memberId })
      .from(postSubscriptions)
      .where(eq(postSubscriptions.postId, postId))
      .limit(500);
  } catch (err) {
    console.warn("[admin-notify-subscribers] postSubs 조회 실패", err);
  }

  // 게시판 카테고리 구독자
  let boardSubs: any[] = [];
  try {
    boardSubs = await db.select({ memberId: postSubscriptions.memberId })
      .from(postSubscriptions)
      .where(
        and(
          eq(postSubscriptions.boardCategory, String(postRow.boardCategory)),
          isNull(postSubscriptions.postId),
        )
      )
      .limit(500);
  } catch (err) {
    console.warn("[admin-notify-subscribers] boardSubs 조회 실패", err);
  }

  // 중복 제거 + 댓글 작성자 본인 제외
  const commentAuthorId = auth.user.uid as number;
  const recipientIds = [
    ...new Set([...postSubs, ...boardSubs].map((r) => r.memberId as number)),
  ].filter((id) => id !== commentAuthorId);

  let notified = 0;
  const link = `/board-post.html?id=${postId}`;
  for (const recipientId of recipientIds) {
    try {
      await createNotification({
        recipientId,
        recipientType: "user",
        category: "system",
        severity: "info",
        title: `구독 중인 게시글에 새 댓글이 등록됐습니다`,
        message: `${commentAuthorName}: ${commentPreview}`,
        link,
        refTable: "board_comments",
        refId: commentId,
        expiresInDays: 30,
      });
      notified++;
    } catch (_) {}
  }

  return new Response(JSON.stringify({ ok: true, notified }), {
    headers: { "Content-Type": "application/json" },
  });
};
