/**
 * POST /api/chat/upload
 * multipart/form-data: file + roomId
 * → Netlify Blobs에 저장 + chat_attachments에 기록
 * → 1년 후 expires_at 설정
 */
import { getStore } from "@netlify/blobs";
import { eq } from "drizzle-orm";
import { db, chatRooms, chatAttachments } from "../../db";
import { authenticateUser } from "../../lib/auth";
import { canEnterExpertRoom, ROOM_TYPE_EXPERT } from "../../lib/expert-match";
import { ok, badRequest, unauthorized, forbidden, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/* OP-063: 매직바이트로 실제 이미지 여부 확인 (Content-Type 위조 방어) */
function sniffImage(b: Uint8Array): boolean {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;                  // JPEG
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; // PNG
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true; // GIF8
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true;             // RIFF....WEBP
  return false;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const auth = authenticateUser(req);
  if (!auth) return unauthorized("로그인이 필요합니다");

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const roomIdStr = formData.get("roomId") as string | null;

    if (!file) return badRequest("파일이 없습니다");
    if (!roomIdStr) return badRequest("roomId가 필요합니다");

    const roomId = Number(roomIdStr);
    if (!Number.isFinite(roomId)) return badRequest("유효하지 않은 roomId");

    /* 파일 검증 */
    if (!ALLOWED_TYPES.includes(file.type)) {
      return badRequest("이미지 파일만 업로드 가능합니다 (JPEG, PNG, GIF, WebP)");
    }
    if (file.size > MAX_SIZE) {
      return badRequest("파일 크기는 10MB 이하여야 합니다");
    }

    /* 채팅방 소유자 검증 */
    const [room] = await db
      .select({ id: chatRooms.id, memberId: chatRooms.memberId, status: chatRooms.status, expertId: chatRooms.expertId, roomType: chatRooms.roomType })
      .from(chatRooms)
      .where(eq(chatRooms.id, roomId))
      .limit(1);

    if (!room) return badRequest("채팅방을 찾을 수 없습니다");
    // ★ Q3-038 fix: expert_1on1 룸은 배정 전문가도 업로드 허용 (메시지 경로와 동일 canEnterExpertRoom 정책)
    if ((room as any).roomType === ROOM_TYPE_EXPERT) {
      if (!canEnterExpertRoom(room as any, auth.uid, false)) return forbidden("접근 권한이 없습니다");
    } else if (room.memberId !== auth.uid) {
      return forbidden("접근 권한이 없습니다");
    }
    if (room.status !== "active") return forbidden("종료된 채팅방입니다");

    /* Blob 저장 */
    const store = getStore("chat-images");
    const ext = file.name.split(".").pop() || "jpg";
    const key = `chat/${roomId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const buffer = await file.arrayBuffer();
    /* OP-063: 확장자·Content-Type만 신뢰하면 이미지로 위장한 파일이 통과 → 실제 바이트 시그니처 확인 */
    if (!sniffImage(new Uint8Array(buffer))) {
      return badRequest("이미지 파일이 아닙니다 (형식 위조가 감지되었습니다)");
    }
    await store.set(key, Buffer.from(new Uint8Array(buffer)) as any, { metadata: { contentType: file.type } });

    /* DB 기록 */
    const oneYear = new Date();
    oneYear.setFullYear(oneYear.getFullYear() + 1);

    const insertData: any = {
      roomId,
      uploaderId: auth.uid,
      blobKey: key,
      originalName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      expiresAt: oneYear,
    };

    const [attachment] = await db
      .insert(chatAttachments)
      .values(insertData)
      .returning();

    return ok({
      attachment: {
        id: attachment.id,
        blobKey: attachment.blobKey,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
      },
    }, "이미지가 업로드되었습니다");
  } catch (err) {
    console.error("[chat-upload]", err);
    return serverError("이미지 업로드 중 오류", err);
  }
};

export const config = { path: "/api/chat/upload" };