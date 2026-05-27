/**
 * 라운드 9 — 채팅 메시지 수정 (5분 제한)
 * PATCH /api/chat-message-update  (requireActiveUser)
 *
 * 본인 메시지만 5분 이내에 수정 가능. soft delete 된 메시지는 거부.
 *
 * 요청: { messageId, content }
 * 응답(성공): { ok, messageId, editedAt }
 * 응답(5분 초과): { ok:false, error, step:"check_time" } (403)
 *
 * ★ schema.ts의 edited_at/is_deleted 컬럼은 마이그 후 활성화 — 본 함수는 raw SQL로 동작
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireActiveUser } from "../../lib/auth";

export const config = { path: "/api/chat-message-update" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

const EDIT_WINDOW_MS = 5 * 60 * 1000; // 5분
const MAX_CONTENT_LEN = 5000;

function jsonError(status: number, step: string, error: string, detail?: any) {
  return new Response(
    JSON.stringify({ ok: false, error, step, detail: detail ? String(detail).slice(0, 500) : undefined }),
    { status, headers: JSON_HEADER }
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "PATCH") return jsonError(405, "method", "PATCH만 허용");

  const auth = await requireActiveUser(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const meUid = auth.user.uid;

  let body: any;
  try {
    body = await req.json();
  } catch (e: any) {
    return jsonError(400, "parse", "JSON 본문 파싱 실패", e?.message);
  }

  const messageId = Number(body?.messageId);
  const content = String(body?.content || "").trim();
  if (!Number.isFinite(messageId) || messageId <= 0) return jsonError(400, "validate", "messageId 필수");
  if (!content) return jsonError(400, "validate", "content 필수");
  if (content.length > MAX_CONTENT_LEN) return jsonError(400, "validate", `content 최대 ${MAX_CONTENT_LEN}자`);

  try {
    /* select_message — 본인 메시지만 */
    const sel: any = await db.execute(sql`
      SELECT id, sender_id, created_at, is_deleted, room_id
        FROM chat_messages
       WHERE id = ${messageId}
       LIMIT 1
    `);
    const row = (sel?.rows ?? sel ?? [])[0];
    if (!row) return jsonError(404, "select_message", "메시지를 찾을 수 없습니다");
    if (Number(row.sender_id) !== Number(meUid)) {
      return jsonError(403, "select_message", "본인 메시지만 수정할 수 있습니다");
    }

    /* check_deleted */
    if (row.is_deleted) return jsonError(403, "check_deleted", "삭제된 메시지입니다.");

    /* ★ Q3-051 fix: 종료(closed)된 채팅방의 메시지는 수정 금지 (기록 불변성 — 전송 경로와 일관) */
    try {
      const rr: any = await db.execute(sql`SELECT status FROM chat_rooms WHERE id = ${row.room_id} LIMIT 1`);
      const rst = (rr?.rows ?? rr ?? [])[0]?.status;
      if (rst && rst !== "active") return jsonError(403, "room_closed", "종료된 채팅방의 메시지는 수정할 수 없습니다.");
    } catch (_) { /* 방 상태 조회 실패 시 기존 동작 */ }

    /* check_time — 5분 초과 */
    const createdAt = new Date(row.created_at);
    if (Date.now() - createdAt.getTime() > EDIT_WINDOW_MS) {
      return jsonError(403, "check_time", "5분이 지난 메시지는 수정할 수 없습니다.");
    }

    /* update */
    const editedAt = new Date();
    await db.execute(sql`
      UPDATE chat_messages
         SET content = ${content},
             edited_at = ${editedAt}
       WHERE id = ${messageId}
    `);

    return new Response(
      JSON.stringify({ ok: true, messageId, editedAt: editedAt.toISOString() }),
      { status: 200, headers: JSON_HEADER }
    );
  } catch (err: any) {
    console.error("[chat-message-update]", err);
    return jsonError(500, "update", "메시지 수정 실패", err?.message);
  }
};
