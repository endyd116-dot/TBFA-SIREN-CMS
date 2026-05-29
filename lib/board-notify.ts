// lib/board-notify.ts
// ★ US-036/037: 게시글 새 댓글 시 구독자 알림 발송 (직접 구독 + 게시판 카테고리 구독).
//   기존엔 발송 함수(admin-notify-subscribers)가 어디서도 호출되지 않아 구독 기능이 죽어 있었고,
//   링크도 존재하지 않는 /board-post.html 이라 눌러도 404였다. 이 lib을 댓글 작성 직후 직접 호출한다.
//   - 댓글이 해당 게시글 소속·미숨김·작성자 본인(callerUid)인지 검증(사칭/스팸 차단).
//   - 발신자명·본문은 DB 값만 사용(익명 댓글은 author_name이 작성 시점에 이미 '익명'으로 저장됨).
//   - 실패해도 throw 하지 않음(fire-and-forget). 발송 건수 반환.
import { db } from "../db";
import { postSubscriptions, boardPosts, boardComments } from "../db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { createNotification } from "./notify";

export async function notifyPostSubscribers(postId: number, commentId: number, callerUid: number): Promise<number> {
  try {
    if (!postId || !commentId) return 0;

    const [postRow] = await db
      .select({ id: boardPosts.id, title: boardPosts.title, boardCategory: boardPosts.category })
      .from(boardPosts).where(eq(boardPosts.id, postId)).limit(1);
    if (!postRow) return 0;

    const [commentRow] = await db
      .select({
        id: boardComments.id, postId: boardComments.postId, memberId: boardComments.memberId,
        authorName: boardComments.authorName, content: boardComments.content, isHidden: boardComments.isHidden,
      })
      .from(boardComments).where(eq(boardComments.id, commentId)).limit(1);
    if (!commentRow || Number(commentRow.postId) !== postId) return 0;
    /* 본인 댓글만 트리거 가능(사칭 차단) + 숨김 댓글은 발송 안 함 */
    if (commentRow.memberId == null || Number(commentRow.memberId) !== callerUid) return 0;
    if (commentRow.isHidden) return 0;

    const commentAuthorName = String(commentRow.authorName || "누군가");
    const commentPreview = String(commentRow.content || "").slice(0, 100);

    let postSubs: any[] = [];
    try {
      postSubs = await db.select({ memberId: postSubscriptions.memberId })
        .from(postSubscriptions).where(eq(postSubscriptions.postId, postId)).limit(500);
    } catch (e) { console.warn("[board-notify] postSubs 조회 실패", e); }

    let boardSubs: any[] = [];
    try {
      boardSubs = await db.select({ memberId: postSubscriptions.memberId })
        .from(postSubscriptions)
        .where(and(eq(postSubscriptions.boardCategory, String(postRow.boardCategory)), isNull(postSubscriptions.postId)))
        .limit(500);
    } catch (e) { console.warn("[board-notify] boardSubs 조회 실패", e); }

    const recipientIds = [...new Set([...postSubs, ...boardSubs].map((r) => r.memberId as number))]
      .filter((id) => id != null && id !== callerUid);

    let notified = 0;
    const link = `/board-view.html?id=${postId}`;   /* ★US-037: 실제 게시글 보기 페이지 */
    for (const recipientId of recipientIds) {
      try {
        await createNotification({
          recipientId,
          recipientType: "user",
          category: "system",
          severity: "info",
          title: "구독 중인 게시글에 새 댓글이 등록됐습니다",
          message: `${commentAuthorName}: ${commentPreview}`,
          link,
          refTable: "board_comments",
          refId: commentId,
          expiresInDays: 30,
        });
        notified++;
      } catch (_) {}
    }
    return notified;
  } catch (e) {
    console.warn("[board-notify] notifyPostSubscribers 예외(무시)", e);
    return 0;
  }
}
