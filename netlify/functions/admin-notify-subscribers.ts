// admin-notify-subscribers.ts — 게시글 새 댓글 시 구독자 알림 발송 (HTTP 엔드포인트)
// POST /api/admin-notify-subscribers  body: { postId, commentId }
// US-036/037: 실제 발송 로직은 lib/board-notify 로 단일화(댓글 작성 직후 board-comment-create 가 직접 호출).
//   이 엔드포인트는 하위호환용 얇은 래퍼 — 본인(댓글 작성자) 검증·링크 정합은 lib 내부에서 처리.
import { jsonKST } from "../../lib/kst";
import { requireActiveUser } from "../../lib/auth";
import { notifyPostSubscribers } from "../../lib/board-notify";

export const config = { path: "/api/admin-notify-subscribers" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "구독자 알림 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request) => {
  if (req.method !== "POST") {
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

  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return jsonError("parse_body", err);
  }

  const postId = Number(body.postId);
  const commentId = Number(body.commentId);
  if (!postId || !commentId) {
    return new Response(jsonKST({ ok: false, error: "postId, commentId 필요" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const notified = await notifyPostSubscribers(postId, commentId, auth.user.uid as number);
    return new Response(jsonKST({ ok: true, notified }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return jsonError("notify", err);
  }
};
