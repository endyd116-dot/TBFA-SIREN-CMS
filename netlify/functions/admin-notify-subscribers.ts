// admin-notify-subscribers.ts — 게시글 새 댓글 시 구독자 알림 발송
// POST /api/admin-notify-subscribers
// body: { postId, commentId, commentPreview, commentAuthorName }
// 게시글·댓글 API 내부에서 호출 (fire-and-forget 패턴)
import { requireActiveUser } from "../../lib/auth";
import { db } from "../../db";
import { postSubscriptions, boardPosts, boardComments } from "../../db/schema";
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
  /* ★ Q4-001 fix: 발신자명·본문은 클라 입력을 신뢰하지 않는다(사칭·스팸 차단).
     댓글 레코드를 DB에서 조회해 실제 author_name·content 로만 알림을 만든다. */

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

  /* ★ Q4-001 fix: 댓글 레코드 조회 + 검증.
     - 댓글이 실제 그 게시글(postId) 소속인지 확인
     - 호출 주체(auth.user.uid)가 그 댓글 작성자 본인인지 확인 → 타인이 임의 댓글ID로
       구독자 전원에게 알림을 쏘는 사칭/스팸을 차단(정상 호출은 댓글 작성 직후 작성자 본인).
     - 발신자명·본문은 DB의 author_name·content 만 사용(익명 댓글의 author_name 은
       작성 시점에 이미 익명 처리되어 저장됨). */
  const callerUid = auth.user.uid as number;
  let commentRow: any;
  try {
    const rows = await db.select({
      id: boardComments.id,
      postId: boardComments.postId,
      memberId: boardComments.memberId,
      authorName: boardComments.authorName,
      content: boardComments.content,
      isHidden: boardComments.isHidden,
    }).from(boardComments).where(eq(boardComments.id, commentId)).limit(1);
    commentRow = rows[0];
  } catch (err) {
    return jsonError("select_comment", err);
  }
  if (!commentRow || Number(commentRow.postId) !== postId) {
    return new Response(JSON.stringify({ ok: false, error: "댓글을 찾을 수 없거나 게시글과 일치하지 않습니다" }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }
  if (commentRow.memberId == null || Number(commentRow.memberId) !== callerUid) {
    /* 본인 댓글이 아님 — 사칭 시도. fire-and-forget 호출이라 200으로 조용히 차단. */
    return new Response(JSON.stringify({ ok: true, notified: 0, skipped: "댓글 작성자 본인만 알림 발송 가능" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  if (commentRow.isHidden) {
    /* 숨김(모더레이션) 댓글은 알림 안 보냄 */
    return new Response(JSON.stringify({ ok: true, notified: 0, skipped: "숨김 처리된 댓글" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  const commentAuthorName: string = String(commentRow.authorName || "누군가");
  const commentPreview: string = String(commentRow.content || "").slice(0, 100);

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
