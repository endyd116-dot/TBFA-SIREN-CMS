/**
 * 라운드 9 — 채팅 메시지 삭제 (soft delete)
 * DELETE /api/chat-message-delete  (requireActiveUser)
 *
 * 본인 메시지만 삭제 가능. isDeleted=true, deletedAt=now(), content=null로 갱신.
 *
 * 요청: { messageId }  (body or ?messageId=)
 * 응답: { ok }
 *
 * schema.ts의 is_deleted/deleted_at 컬럼은 마이그 후 활성화 — 본 함수는 raw SQL
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireActiveUser } from "../../lib/auth";

export const config = { path: "/api/chat-message-delete" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonError(status: number, step: string, error: string, detail?: any) {
  return new Response(
    jsonKST({ ok: false, error, step, detail: detail ? String(detail).slice(0, 500) : undefined }),
    { status, headers: JSON_HEADER }
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "DELETE") return jsonError(405, "method", "DELETE만 허용");

  const auth = await requireActiveUser(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const meUid = auth.user.uid;

  /* messageId — body 우선, 없으면 query string */
  let messageId = 0;
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body: any = await req.json().catch(() => null);
      if (body?.messageId) messageId = Number(body.messageId);
    }
  } catch (_) { /* ignore */ }
  if (!messageId) {
    const url = new URL(req.url);
    messageId = Number(url.searchParams.get("messageId") || 0);
  }
  if (!Number.isFinite(messageId) || messageId <= 0) return jsonError(400, "validate", "messageId 필수");

  try {
    /* select_message — 본인 메시지만 */
    const sel: any = await db.execute(sql`
      SELECT id, sender_id, is_deleted, room_id
        FROM chat_messages
       WHERE id = ${messageId}
       LIMIT 1
    `);
    const row = (sel?.rows ?? sel ?? [])[0];
    if (!row) return jsonError(404, "select_message", "메시지를 찾을 수 없습니다");
    if (Number(row.sender_id) !== Number(meUid)) {
      return jsonError(403, "select_message", "본인 메시지만 삭제할 수 있습니다");
    }
    if (row.is_deleted) {
      /* 멱등 — 이미 삭제된 경우 ok */
      return new Response(jsonKST({ ok: true }), { status: 200, headers: JSON_HEADER });
    }

    /* Q3-051 fix: 종료(closed)된 채팅방의 메시지는 삭제 금지 (기록 불변성 — 전송 경로와 일관) */
    try {
      const rr: any = await db.execute(sql`SELECT status FROM chat_rooms WHERE id = ${row.room_id} LIMIT 1`);
      const rst = (rr?.rows ?? rr ?? [])[0]?.status;
      if (rst && rst !== "active") return jsonError(403, "room_closed", "종료된 채팅방의 메시지는 삭제할 수 없습니다.");
    } catch (_) { /* 방 상태 조회 실패 시 기존 동작 */ }

    /* update — soft delete */
    await db.execute(sql`
      UPDATE chat_messages
         SET is_deleted = TRUE,
             deleted_at = NOW(),
             content = NULL
       WHERE id = ${messageId}
    `);

    return new Response(jsonKST({ ok: true }), { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    console.error("[chat-message-delete]", err);
    return jsonError(500, "update", "메시지 삭제 실패", err?.message);
  }
};
