/**
 * GET  /api/chat/mine    — 내 채팅방 목록
 * POST /api/chat/mine    — 새 채팅방 생성
 *                          body: { category, title? }
 */
import { eq, and, desc } from "drizzle-orm";
import { db, chatRooms, chatBlacklist } from "../../db";
import { authenticateUser } from "../../lib/auth";
import {
  ok, badRequest, unauthorized, forbidden, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

const VALID_CATEGORIES = [
  "support_donation",
  "support_homepage",
  "support_signup",
  "support_other",
];

const CATEGORY_TITLE: Record<string, string> = {
  support_donation: "후원 관련 문의",
  support_homepage: "홈페이지 이용 문의",
  support_signup: "가입 절차 문의",
  support_other: "기타 문의",
};

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const auth = authenticateUser(req);
  if (!auth) return unauthorized("로그인이 필요합니다");

  try {
    /* ===== GET — 내 채팅방 목록 ===== */
    if (req.method === "GET") {
      const rooms = await db
        .select({
          id: chatRooms.id,
          category: chatRooms.category,
          title: chatRooms.title,
          status: chatRooms.status,
          lastMessageAt: chatRooms.lastMessageAt,
          lastMessagePreview: chatRooms.lastMessagePreview,
          unreadForUser: chatRooms.unreadForUser,
          createdAt: chatRooms.createdAt,
          closedAt: chatRooms.closedAt,
        })
        .from(chatRooms)
        .where(eq(chatRooms.memberId, auth.uid))
        .orderBy(desc(chatRooms.lastMessageAt))
        .limit(50);

      /* 블랙리스트 상태 함께 응답 */
      const [black] = await db
        .select({ reason: chatBlacklist.reason, blockedAt: chatBlacklist.blockedAt })
        .from(chatBlacklist)
        .where(and(eq(chatBlacklist.memberId, auth.uid), eq(chatBlacklist.isActive, true)))
        .limit(1);

      return ok({
        rooms,
        blacklisted: black ? { reason: black.reason, blockedAt: black.blockedAt } : null,
      });
    }

    /* ===== POST — 새 채팅방 생성 ===== */
    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const category = String(body.category || "").trim();
      if (!VALID_CATEGORIES.includes(category)) {
        return badRequest("유효하지 않은 카테고리입니다");
      }

      /* 블랙리스트 체크 */
      const [black] = await db
        .select({ reason: chatBlacklist.reason })
        .from(chatBlacklist)
        .where(and(eq(chatBlacklist.memberId, auth.uid), eq(chatBlacklist.isActive, true)))
        .limit(1);

      if (black) {
        return forbidden(`채팅 이용이 제한된 회원입니다. 사유: ${black.reason}`);
      }

      /* 동일 카테고리의 active 채팅방이 이미 있으면 그걸 반환 (중복 생성 방지) */
      const [existing] = await db
        .select()
        .from(chatRooms)
        .where(
          and(
            eq(chatRooms.memberId, auth.uid),
            eq(chatRooms.category, category),
            eq(chatRooms.status, "active")
          )
        )
        .limit(1);

      if (existing) {
        return ok({ room: existing, isNew: false }, "기존 채팅방으로 입장합니다");
      }

      /* 새 채팅방 생성 */
      const titleInput = String(body.title || "").trim().slice(0, 200);
      const title = titleInput || CATEGORY_TITLE[category] || "1:1 상담";

      const insertData: any = {
        memberId: auth.uid,
        category,
        title,
        status: "active",
        lastMessageAt: new Date(),
        lastMessagePreview: "[채팅방 시작]",
      };

      const [room] = await db
        .insert(chatRooms)
        .values(insertData)
        .returning();

      return ok({ room, isNew: true }, "채팅방이 생성되었습니다");
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[chat-mine]", err);
    return serverError("채팅방 처리 중 오류", err);
  }
};

export const config = { path: "/api/chat/mine" };