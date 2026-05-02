/**
 * GET   /api/admin/chat/messages?roomId=N&since=ISO   — 메시지 조회 (폴링)
 * POST  /api/admin/chat/messages                       — 관리자 메시지 전송
 *                                                        body: { roomId, content, messageType?, attachmentId? }
 * PATCH /api/admin/chat/messages                       — 관리자 측 읽음 처리
 *                                                        body: { roomId }
 */
import { eq, and, gt, asc } from "drizzle-orm";
import { db, chatRooms, chatMessages } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, forbidden, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    /* ===== GET — 메시지 조회 ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const roomId = Number(url.searchParams.get("roomId"));
      const since = url.searchParams.get("since");

      if (!Number.isFinite(roomId)) return badRequest("roomId가 필요합니다");

      const [room] = await db
        .select()
        .from(chatRooms)
        .where(eq(chatRooms.id, roomId))
        .limit(1);
      if (!room) return notFound("채팅방을 찾을 수 없습니다");

      let whereClause: any = eq(chatMessages.roomId, roomId);
      if (since) {
        try {
          const sinceDate = new Date(since);
          if (!isNaN(sinceDate.getTime())) {
            whereClause = and(eq(chatMessages.roomId, roomId), gt(chatMessages.createdAt, sinceDate));
          }
        } catch (e) {}
      }

      const messages = await db
        .select()
        .from(chatMessages)
        .where(whereClause)
        .orderBy(asc(chatMessages.createdAt))
        .limit(300);

      return ok({ messages, room });
    }

    /* ===== POST — 관리자 메시지 전송 ===== */
    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const roomId = Number(body.roomId);
      const content = String(body.content || "").trim().slice(0, 5000);
      const messageType = String(body.messageType || "text");
      const attachmentId = body.attachmentId ? Number(body.attachmentId) : null;

      if (!Number.isFinite(roomId)) return badRequest("roomId가 필요합니다");
      if (!content && !attachmentId) return badRequest("내용 또는 첨부파일이 필요합니다");
      if (!["text", "image", "system_notice"].includes(messageType)) return badRequest("유효하지 않은 메시지 타입");

      const [room] = await db
        .select()
        .from(chatRooms)
        .where(eq(chatRooms.id, roomId))
        .limit(1);
      if (!room) return notFound("채팅방을 찾을 수 없습니다");
      if (room.status !== "active") return forbidden("종료/보관된 채팅방에는 메시지를 보낼 수 없습니다");

      const insertData: any = {
        roomId,
        senderId: admin.uid,
        senderRole: "admin",
        messageType,
        content: content || null,
        attachmentId,
        isSystem: messageType === "system_notice",
      };

      const [message] = await db
        .insert(chatMessages)
        .values(insertData)
        .returning();

      /* 채팅방 메타 업데이트 (사용자 미읽음 +1) */
      const preview = (content || "[이미지]").slice(0, 200);
      const updateMeta: any = {
        lastMessageAt: new Date(),
        lastMessagePreview: preview,
        unreadForUser: (room.unreadForUser || 0) + 1,
        updatedAt: new Date(),
      };
      await db
        .update(chatRooms)
        .set(updateMeta)
        .where(eq(chatRooms.id, roomId));

      return ok({ message }, "메시지가 전송되었습니다");
    }

    /* ===== PATCH — 관리자 측 읽음 처리 ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      const roomId = Number(body?.roomId);
      if (!Number.isFinite(roomId)) return badRequest("roomId가 필요합니다");

      const [room] = await db
        .select({ id: chatRooms.id })
        .from(chatRooms)
        .where(eq(chatRooms.id, roomId))
        .limit(1);
      if (!room) return notFound("채팅방을 찾을 수 없습니다");

      const updateRead: any = { unreadForAdmin: 0 };
      await db
        .update(chatRooms)
        .set(updateRead)
        .where(eq(chatRooms.id, roomId));

      return ok({}, "읽음 처리 완료");
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-chat-messages]", err);
    return serverError("메시지 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin/chat/messages" };