/**
 * GET    /api/admin/chat/rooms                    — 전체 채팅방 목록 (필터/검색)
 *        ?status=active|closed|archived
 *        ?category=support_donation|...
 *        ?q=회원이름검색
 * GET    /api/admin/chat/rooms?id=N               — 단일 채팅방 상세 + 회원 정보
 * PATCH  /api/admin/chat/rooms                    — 메모/종료/아카이브
 *        body: { id, adminMemo?, status? ('active'|'closed'|'archived') }
 * POST   /api/admin/chat/rooms?action=blacklist   — 블랙리스트 등록
 *        body: { memberId, reason }
 * DELETE /api/admin/chat/rooms?action=blacklist&memberId=N — 블랙 해제
 * GET    /api/admin/chat/rooms?listType=blacklist — 블랙리스트 목록
 */
import { eq, and, desc, like, or, count, sql, inArray } from "drizzle-orm";
import { db, chatRooms, chatMessages, chatBlacklist, members, donations, supportRequests } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, forbidden, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const listType = url.searchParams.get("listType");

    /* ===== GET ===== */
    if (req.method === "GET") {

      /* ─── 블랙리스트 목록 ─── */
      if (listType === "blacklist") {
        const list = await db
          .select({
            id: chatBlacklist.id,
            memberId: chatBlacklist.memberId,
            reason: chatBlacklist.reason,
            blockedBy: chatBlacklist.blockedBy,
            blockedAt: chatBlacklist.blockedAt,
            unblockedAt: chatBlacklist.unblockedAt,
            isActive: chatBlacklist.isActive,
            memberName: members.name,
            memberEmail: members.email,
          })
          .from(chatBlacklist)
          .leftJoin(members, eq(chatBlacklist.memberId, members.id))
          .orderBy(desc(chatBlacklist.blockedAt))
          .limit(100);

        return ok({ blacklist: list });
      }

      const id = url.searchParams.get("id");

      /* ─── 단일 채팅방 + 회원 종합 정보 ─── */
      if (id) {
        const reqId = Number(id);
        if (!Number.isFinite(reqId)) return badRequest("유효하지 않은 ID");

        const [room] = await db
          .select()
          .from(chatRooms)
          .where(eq(chatRooms.id, reqId))
          .limit(1);

        if (!room) return notFound("채팅방을 찾을 수 없습니다");

        /* 회원 정보 */
        const [member] = await db
          .select({
            id: members.id,
            name: members.name,
            email: members.email,
            phone: members.phone,
            type: members.type,
            status: members.status,
            createdAt: members.createdAt,
            lastLoginAt: members.lastLoginAt,
          })
          .from(members)
          .where(eq(members.id, room.memberId))
          .limit(1);

        /* 회원 활동 요약 (간단) */
        const donationStats: any = await db
          .select({
            total: sql<number>`COALESCE(SUM(${donations.amount}), 0)`,
            cnt: count(),
          })
          .from(donations)
          .where(and(eq(donations.memberId, room.memberId), eq(donations.status, "completed")));

        const supportCnt: any = await db
          .select({ c: count() })
          .from(supportRequests)
          .where(eq(supportRequests.memberId, room.memberId));

        /* 블랙리스트 상태 */
        const [black] = await db
          .select({
            reason: chatBlacklist.reason,
            blockedAt: chatBlacklist.blockedAt,
          })
          .from(chatBlacklist)
          .where(and(eq(chatBlacklist.memberId, room.memberId), eq(chatBlacklist.isActive, true)))
          .limit(1);

        return ok({
          room,
          member,
          summary: {
            donationTotal: Number(donationStats[0]?.total ?? 0),
            donationCount: Number(donationStats[0]?.cnt ?? 0),
            supportCount: Number(supportCnt[0]?.c ?? 0),
          },
          blacklist: black || null,
        });
      }

      /* ─── 채팅방 목록 (필터) ─── */
      const status = url.searchParams.get("status");
      const category = url.searchParams.get("category");
      const q = (url.searchParams.get("q") || "").trim();
      const limit = Math.min(200, Number(url.searchParams.get("limit") || 100));

      const conditions: any[] = [];
      if (status && ["active", "closed", "archived"].includes(status)) {
        conditions.push(eq(chatRooms.status, status));
      }
      if (category) {
        conditions.push(eq(chatRooms.category, category));
      }

      let whereClause: any = conditions.length === 0 ? undefined : and(...conditions);

      /* 회원 이름/이메일 검색 — JOIN 필요 */
      if (q && q.length >= 2) {
        const searchCond = or(
          like(members.name, `%${q}%`),
          like(members.email, `%${q}%`)
        );
        whereClause = whereClause ? and(whereClause, searchCond) : searchCond;
      }

      const rooms = await db
        .select({
          id: chatRooms.id,
          memberId: chatRooms.memberId,
          category: chatRooms.category,
          title: chatRooms.title,
          status: chatRooms.status,
          lastMessageAt: chatRooms.lastMessageAt,
          lastMessagePreview: chatRooms.lastMessagePreview,
          unreadForAdmin: chatRooms.unreadForAdmin,
          unreadForUser: chatRooms.unreadForUser,
          adminMemo: chatRooms.adminMemo,
          closedAt: chatRooms.closedAt,
          archivedAt: chatRooms.archivedAt,
          createdAt: chatRooms.createdAt,
          memberName: members.name,
          memberEmail: members.email,
        })
        .from(chatRooms)
        .leftJoin(members, eq(chatRooms.memberId, members.id))
        .where(whereClause)
        .orderBy(desc(chatRooms.lastMessageAt))
        .limit(limit);

      /* 통계 */
      const [activeCnt] = await db.select({ c: count() }).from(chatRooms).where(eq(chatRooms.status, "active"));
      const [closedCnt] = await db.select({ c: count() }).from(chatRooms).where(eq(chatRooms.status, "closed"));
      const [archivedCnt] = await db.select({ c: count() }).from(chatRooms).where(eq(chatRooms.status, "archived"));

      /* 전체 미읽음 카운트 (admin이 봐야 할 것) */
      const unreadRows: any = await db
        .select({ s: sql<number>`COALESCE(SUM(${chatRooms.unreadForAdmin}), 0)` })
        .from(chatRooms)
        .where(eq(chatRooms.status, "active"));

      return ok({
        rooms,
        stats: {
          active: Number(activeCnt?.c ?? 0),
          closed: Number(closedCnt?.c ?? 0),
          archived: Number(archivedCnt?.c ?? 0),
          totalUnread: Number(unreadRows[0]?.s ?? 0),
        },
      });
    }

    /* ===== POST — 블랙리스트 등록 ===== */
    if (req.method === "POST" && action === "blacklist") {
      const body = await parseJson(req);
      const memberId = Number(body?.memberId);
      const reason = String(body?.reason || "").trim();

      if (!Number.isFinite(memberId)) return badRequest("memberId가 필요합니다");
      if (!reason || reason.length < 2) return badRequest("차단 사유를 입력하세요");

      const [target] = await db
        .select({ id: members.id, name: members.name })
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);
      if (!target) return notFound("회원을 찾을 수 없습니다");

      /* 기존 활성 블랙 있으면 차단 */
      const [existing] = await db
        .select()
        .from(chatBlacklist)
        .where(and(eq(chatBlacklist.memberId, memberId), eq(chatBlacklist.isActive, true)))
        .limit(1);

      if (existing) return badRequest("이미 블랙리스트에 등록된 회원입니다");

      const insertData: any = {
        memberId,
        reason,
        blockedBy: admin.uid,
        isActive: true,
      };
      const [created] = await db.insert(chatBlacklist).values(insertData).returning();

      /* 해당 회원의 active 채팅방을 closed 처리 */
      const closeData: any = { status: "closed", closedAt: new Date(), closedBy: admin.uid, updatedAt: new Date() };
      await db
        .update(chatRooms)
        .set(closeData)
        .where(and(eq(chatRooms.memberId, memberId), eq(chatRooms.status, "active")));

      await logAdminAction(req, admin.uid, admin.name, "chat_blacklist_add", {
        target: `M-${memberId}`,
        detail: { name: target.name, reason },
      });

      return ok({ blacklist: created }, `${target.name}님을 채팅 블랙리스트에 등록했습니다`);
    }

    /* ===== DELETE — 블랙 해제 ===== */
    if (req.method === "DELETE" && action === "blacklist") {
      const memberId = Number(url.searchParams.get("memberId"));
      if (!Number.isFinite(memberId)) return badRequest("memberId가 필요합니다");

      const [existing] = await db
        .select()
        .from(chatBlacklist)
        .where(and(eq(chatBlacklist.memberId, memberId), eq(chatBlacklist.isActive, true)))
        .limit(1);
      if (!existing) return notFound("활성 블랙리스트가 없습니다");

      const updateData: any = {
        isActive: false,
        unblockedAt: new Date(),
        unblockedBy: admin.uid,
      };
      await db
        .update(chatBlacklist)
        .set(updateData)
        .where(eq(chatBlacklist.id, existing.id));

      await logAdminAction(req, admin.uid, admin.name, "chat_blacklist_remove", {
        target: `M-${memberId}`,
      });

      return ok({}, "블랙리스트에서 해제되었습니다");
    }

    /* ===== PATCH — 채팅방 업데이트 (메모/종료/아카이브) ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body?.id) return badRequest("id가 필요합니다");

      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const [room] = await db
        .select()
        .from(chatRooms)
        .where(eq(chatRooms.id, id))
        .limit(1);
      if (!room) return notFound("채팅방을 찾을 수 없습니다");

      const updateData: any = { updatedAt: new Date() };

      if (typeof body.adminMemo === "string") {
        updateData.adminMemo = body.adminMemo;
      }

      if (typeof body.status === "string" && ["active", "closed", "archived"].includes(body.status)) {
        updateData.status = body.status;
        if (body.status === "closed" && !room.closedAt) {
          updateData.closedAt = new Date();
          updateData.closedBy = admin.uid;
        }
        if (body.status === "archived" && !room.archivedAt) {
          updateData.archivedAt = new Date();
        }
      }

      const [updated] = await db
        .update(chatRooms)
        .set(updateData)
        .where(eq(chatRooms.id, id))
        .returning();

      await logAdminAction(req, admin.uid, admin.name, "chat_room_update", {
        target: `R-${id}`,
        detail: { fields: Object.keys(updateData) },
      });

      return ok({ room: updated }, "채팅방이 업데이트되었습니다");
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-chat-rooms]", err);
    return serverError("채팅 관리 중 오류", err);
  }
};

export const config = { path: "/api/admin/chat/rooms" };