/**
 * GET   /api/chat/messages?roomId=N&since=ISO   — 메시지 조회 (폴링용)
 * POST  /api/chat/messages                       — 메시지 전송
 *                                                  body: { roomId, content, messageType?, attachmentId? }
 * PATCH /api/chat/messages                       — 사용자 측 읽음 처리
 *                                                  body: { roomId }
 *
 * STEP H-1: 응답에 attachment 객체 합쳐서 전달
 * 6순위 #8: expert_1on1 룸 — canEnterExpertRoom 가드 추가
 */
import { eq, and, gt, asc, inArray, sql, ne } from "drizzle-orm";
import { db, chatRooms, chatMessages, chatBlacklist, chatAttachments, members } from "../../db";
import { authenticateUser, authenticateAdmin } from "../../lib/auth";
import { canEnterExpertRoom, ROOM_TYPE_EXPERT } from "../../lib/expert-match";
import {
  ok, badRequest, unauthorized, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

/* ============ 헬퍼: 메시지 배열에 attachment 정보 합치기 ============ */
async function enrichWithAttachments(messages: any[]): Promise<any[]> {
  if (!messages || messages.length === 0) return messages;

  const ids = messages
    .map((m) => m.attachmentId)
    .filter((v) => typeof v === "number" && v > 0) as number[];

  if (ids.length === 0) {
    return messages.map((m) => ({ ...m, attachment: null }));
  }

  const atts = await db
    .select({
      id: chatAttachments.id,
      originalName: chatAttachments.originalName,
      mimeType: chatAttachments.mimeType,
      width: chatAttachments.width,
      height: chatAttachments.height,
      fileSize: chatAttachments.fileSize,
    })
    .from(chatAttachments)
    .where(inArray(chatAttachments.id, ids));

  const map = new Map<number, any>();
  for (const a of atts as any[]) map.set(a.id, a);

  return messages.map((m) => ({
    ...m,
    attachment: m.attachmentId ? map.get(m.attachmentId) || null : null,
  }));
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  /* 인증 — 어드민 JWT 우선, 없으면 사용자 JWT (전문가 포함) */
  const adminToken = authenticateAdmin(req);
  const userToken = authenticateUser(req);

  let viewerMemberId: number;
  let isAdmin = false;
  let senderBaseRole: "admin" | "user" = "user";

  if (adminToken) {
    viewerMemberId = adminToken.uid;
    isAdmin = true;
    senderBaseRole = "admin";
  } else if (userToken) {
    viewerMemberId = userToken.uid;
  } else {
    return unauthorized("로그인이 필요합니다");
  }

  try {
    /* ===== GET — 메시지 조회 (폴링) ===== */
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

      /* expert_1on1 룸 — 사용자·전문가·어드민만 입장 가능 */
      if (room.roomType === ROOM_TYPE_EXPERT) {
        if (!canEnterExpertRoom(room as any, viewerMemberId, isAdmin)) {
          return forbidden("접근 권한이 없습니다");
        }
      } else if (!isAdmin && room.memberId !== viewerMemberId) {
        return forbidden("접근 권한이 없습니다");
      }

      let whereClause: any = eq(chatMessages.roomId, roomId);
      if (since) {
        try {
          const sinceDate = new Date(since);
          if (!isNaN(sinceDate.getTime())) {
            whereClause = and(eq(chatMessages.roomId, roomId), gt(chatMessages.createdAt, sinceDate));
          }
        } catch (e) { /* ignore */ }
      }

      const rawMessages = await db
        .select()
        .from(chatMessages)
        .where(whereClause)
        .orderBy(asc(chatMessages.createdAt))
        .limit(200);

      const messages = await enrichWithAttachments(rawMessages as any[]);
      return ok({ messages, room });
    }

    /* ===== POST — 메시지 전송 ===== */
    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const roomId = Number(body.roomId);
      const content = String(body.content || "").trim().slice(0, 5000);
      const messageType = String(body.messageType || "text");
      const attachmentId = body.attachmentId ? Number(body.attachmentId) : null;

      if (!Number.isFinite(roomId)) return badRequest("roomId가 필요합니다");
      if (!content && !attachmentId) return badRequest("내용 또는 첨부파일이 필요합니다");
      if (!["text", "image"].includes(messageType)) return badRequest("유효하지 않은 메시지 타입");
      /* OP-063: image 타입 메시지는 첨부 필수 — 빈 이미지 말풍선 방지 */
      if (messageType === "image" && !attachmentId) return badRequest("이미지 메시지에는 첨부가 필요합니다");

      /* 블랙리스트 체크 (사용자만, 어드민·전문가 제외) */
      if (!isAdmin) {
        const [black] = await db
          .select({ reason: chatBlacklist.reason })
          .from(chatBlacklist)
          .where(and(eq(chatBlacklist.memberId, viewerMemberId), eq(chatBlacklist.isActive, true)))
          .limit(1);

        if (black) {
          return forbidden(`채팅 이용이 제한되었습니다. 사유: ${black.reason}`);
        }
      }

      const [room] = await db
        .select()
        .from(chatRooms)
        .where(eq(chatRooms.id, roomId))
        .limit(1);

      if (!room) return notFound("채팅방을 찾을 수 없습니다");

      /* expert_1on1 룸 권한 */
      if (room.roomType === ROOM_TYPE_EXPERT) {
        if (!canEnterExpertRoom(room as any, viewerMemberId, isAdmin)) {
          return forbidden("접근 권한이 없습니다");
        }
      } else if (!isAdmin && room.memberId !== viewerMemberId) {
        return forbidden("접근 권한이 없습니다");
      }

      if (room.status !== "active") return forbidden("종료된 채팅방입니다");

      /* OP-059: 첨부가 지정되면 이 방에 속한 첨부인지 검증 — 타 방 첨부 참조(IDOR성 메타 누출) 차단 */
      if (attachmentId) {
        const [att] = await db
          .select({ id: chatAttachments.id, roomId: chatAttachments.roomId })
          .from(chatAttachments)
          .where(eq(chatAttachments.id, attachmentId))
          .limit(1);
        if (!att || att.roomId !== roomId) return badRequest("유효하지 않은 첨부입니다");
      }

      /* senderRole 결정 — 어드민·전문가·일반 사용자 분기 */
      let senderRole: string = senderBaseRole;
      if (!isAdmin && room.roomType === ROOM_TYPE_EXPERT && room.expertId === viewerMemberId) {
        senderRole = "expert";
      }

      /* OP-066: 전문가 발신 자격 재확인 — 정지·탈퇴된 전문가가 expertId만 남아 계속 발신하던 갭 차단.
         (채팅은 authenticateUser만 써서 status 차단이 안 걸리므로 발신 시점에 재검증) */
      if (senderRole === "expert") {
        const [exp] = await db
          .select({ status: members.status, withdrawnAt: members.withdrawnAt })
          .from(members)
          .where(eq(members.id, viewerMemberId))
          .limit(1);
        if (!exp || exp.status !== "active" || exp.withdrawnAt) {
          return forbidden("상담 자격이 유효하지 않습니다");
        }
      }

      const insertData: any = {
        roomId,
        senderId: viewerMemberId,
        senderRole,
        messageType,
        content: content || null,
        attachmentId,
      };

      const [message] = await db
        .insert(chatMessages)
        .values(insertData)
        .returning();

      const preview = (content || "[이미지]").slice(0, 200);

      /* 읽음 카운터 — 보낸 역할에 따라 상대방 카운터 증가 */
      const isUserSender = senderRole === "user";
      /* OP-065: 미읽음 카운터를 SQL 원자 증감으로 — 기존 read-modify-write는 동시 발신 시 경합으로 어긋남 */
      const updateMeta: any = {
        lastMessageAt: new Date(),
        lastMessagePreview: preview,
        updatedAt: new Date(),
      };
      if (isUserSender) updateMeta.unreadForAdmin = sql`${chatRooms.unreadForAdmin} + 1`;  // 사용자 발신 → 전문가/어드민 측 미읽음
      else updateMeta.unreadForUser = sql`${chatRooms.unreadForUser} + 1`;                 // 전문가/어드민 발신 → 사용자 측 미읽음
      await db
        .update(chatRooms)
        .set(updateMeta)
        .where(eq(chatRooms.id, roomId));

      /* attachment 정보 합쳐서 응답 */
      const [enriched] = await enrichWithAttachments([message] as any[]);
      return ok({ message: enriched }, "메시지가 전송되었습니다");
    }

    /* ===== PATCH — 읽음 처리 ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      const roomId = Number(body?.roomId);
      if (!Number.isFinite(roomId)) return badRequest("roomId가 필요합니다");

      const [room] = await db
        .select({
          id: chatRooms.id,
          memberId: chatRooms.memberId,
          expertId: chatRooms.expertId,
          roomType: chatRooms.roomType,
        })
        .from(chatRooms)
        .where(eq(chatRooms.id, roomId))
        .limit(1);

      if (!room) return notFound("채팅방을 찾을 수 없습니다");

      /* expert_1on1 룸 권한 */
      if (room.roomType === ROOM_TYPE_EXPERT) {
        if (!canEnterExpertRoom(room as any, viewerMemberId, isAdmin)) {
          return forbidden("접근 권한이 없습니다");
        }
      } else if (!isAdmin && room.memberId !== viewerMemberId) {
        return forbidden("접근 권한이 없습니다");
      }

      /* 사용자(memberId)는 unreadForUser 리셋, 전문가·어드민은 unreadForAdmin 리셋 */
      const isUserSide = !isAdmin && room.memberId === viewerMemberId;
      const updateRead: any = isUserSide
        ? { unreadForUser: 0 }
        : { unreadForAdmin: 0 };

      await db
        .update(chatRooms)
        .set(updateRead)
        .where(eq(chatRooms.id, roomId));

      /* OP-065: 메시지별 읽음 추적 — 상대방이 보낸 미읽음 메시지의 isRead/readAt 갱신
         (기존엔 방 단위 카운터만 리셋해 메시지별 '읽음 표시'를 제공할 수 없었음) */
      try {
        await db
          .update(chatMessages)
          .set({ isRead: true, readAt: new Date() } as any)
          .where(and(
            eq(chatMessages.roomId, roomId),
            ne(chatMessages.senderId, viewerMemberId),
            eq(chatMessages.isRead, false)
          ));
      } catch (e) {
        console.warn("[chat-messages] 메시지 읽음 표시 실패:", e);
      }

      return ok({}, "읽음 처리 완료");
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[chat-messages]", err);
    return serverError("메시지 처리 중 오류", err);
  }
};

export const config = { path: "/api/chat/messages" };