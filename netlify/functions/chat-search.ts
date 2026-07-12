/**
 * 라운드 9 — 채팅 메시지 검색
 * GET /api/chat-search?roomId=N&q=검색어&limit=20  (requireActiveUser)
 *
 * 본인 참여 룸의 메시지만 검색. 삭제된 메시지(isDeleted=true) 제외.
 *
 * 응답: { ok, messages: [{ id, content, senderRole, createdAt }] }
 *
 * schema.ts의 is_deleted 컬럼은 마이그 후 활성화 — 본 함수는 raw SQL
 */
import { isoUTC, jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireActiveUser } from "../../lib/auth";

export const config = { path: "/api/chat-search" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonError(status: number, step: string, error: string, detail?: any) {
  return new Response(
    jsonKST({ ok: false, error, step, detail: detail ? String(detail).slice(0, 500) : undefined }),
    { status, headers: JSON_HEADER }
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") return jsonError(405, "method", "GET만 허용");

  const auth = await requireActiveUser(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const meUid = auth.user.uid;

  const url = new URL(req.url);
  const roomId = Number(url.searchParams.get("roomId") || 0);
  const q = String(url.searchParams.get("q") || "").trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20), 1), 100);

  if (!roomId) return jsonError(400, "validate", "roomId 필수");
  if (!q) return jsonError(400, "validate", "q 필수");

  try {
    /* check_room — 본인이 참여한 룸인지 확인 */
    const roomSel: any = await db.execute(sql`
      SELECT id, member_id, expert_id FROM chat_rooms WHERE id = ${roomId} LIMIT 1
    `);
    const room = (roomSel?.rows ?? roomSel ?? [])[0];
    if (!room) return jsonError(404, "check_room", "채팅방을 찾을 수 없습니다");
    const ownerId = Number(room.member_id);
    const expertId = room.expert_id ? Number(room.expert_id) : null;
    if (ownerId !== Number(meUid) && expertId !== Number(meUid)) {
      return jsonError(403, "check_room", "접근 권한이 없습니다");
    }

    /* search — content ILIKE %q% (대소문자 무시, 부분일치) + 삭제 메시지 제외 */
    const like = `%${q.replace(/[%_]/g, (m) => "\\" + m)}%`;
    const sr: any = await db.execute(sql`
      SELECT id, content, sender_role, created_at
        FROM chat_messages
       WHERE room_id = ${roomId}
         AND COALESCE(is_deleted, FALSE) = FALSE
         AND content ILIKE ${like}
       ORDER BY created_at DESC
       LIMIT ${limit}
    `);
    const messages = (sr?.rows ?? sr ?? []).map((m: any) => ({
      id: Number(m.id),
      content: m.content,
      senderRole: m.sender_role,
      createdAt: isoUTC(m.created_at),
    }));

    return new Response(
      jsonKST({ ok: true, messages }),
      { status: 200, headers: JSON_HEADER }
    );
  } catch (err: any) {
    console.error("[chat-search]", err);
    return jsonError(500, "search", "검색 실패", err?.message);
  }
};
