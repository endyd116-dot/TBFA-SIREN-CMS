/**
 * POST /api/admin-expert-assign
 *
 * 6순위 #8 — 어드민이 전문가 배정 + 1:1 채팅방 자동 생성 트랜잭션 (메인 채팅 핵심).
 *
 * 흐름:
 *   1. requireAdmin
 *   2. expert_matches 행 조회 — status='pending' 검증
 *   3. 전문가 자격 검증 (members.type='volunteer' + member_subtype = matchType)
 *   4. 트랜잭션:
 *      a. chat_rooms 신규 INSERT (room_type='expert_1on1', expertId, memberId=user)
 *      b. expert_matches UPDATE (expert_id, chat_room_id, status='matched', assigned_by/at)
 *   5. 응답: { matchId, chatRoomId, expertId }
 *
 * Body:
 *   { matchId: number, expertId: number, adminNote?: string }
 */

import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import {
  db,
  members,
  chatRooms,
  expertMatches,
} from "../../db";
import { supportRequests, legalConsultations } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { createNotification } from "../../lib/notify";
import {
  checkExpertEligibility,
  buildExpertChatRoomTitle,
  isValidMatchType,
  ROOM_TYPE_EXPERT,
  type MatchType,
} from "../../lib/expert-match";

interface Body {
  matchId?: number;
  expertId?: number;
  adminNote?: string;
}

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "전문가 배정 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

function badRequest(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg, step: "validate" }), {
    status: 400,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  /* 1. 어드민 인증 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const adminMemberId = (auth as any).ctx?.member?.id ?? (auth as any).ctx?.admin?.uid ?? null;
  if (!adminMemberId) return badRequest("어드민 식별자 누락");

  /* 2. body 파싱 */
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch (err) {
    return jsonError("parse_body", err, 400);
  }
  const matchId = Number(body.matchId);
  const expertId = Number(body.expertId);
  const adminNote = body.adminNote ? String(body.adminNote).slice(0, 1000) : null;
  if (!Number.isInteger(matchId) || matchId <= 0) return badRequest("matchId가 유효하지 않음");
  if (!Number.isInteger(expertId) || expertId <= 0) return badRequest("expertId가 유효하지 않음");

  /* 3. 매칭 행 조회 */
  let match: typeof expertMatches.$inferSelect | undefined;
  try {
    const rows = await db
      .select()
      .from(expertMatches)
      .where(eq(expertMatches.id, matchId))
      .limit(1);
    match = rows[0];
  } catch (err) {
    return jsonError("select_match", err);
  }
  if (!match) return badRequest("매칭 행을 찾을 수 없음");
  if (match.status !== "pending") {
    return badRequest(`이미 처리된 매칭 (status=${match.status})`);
  }
  if (!isValidMatchType(match.matchType)) {
    return badRequest(`매칭 종류가 유효하지 않음 (matchType=${match.matchType})`);
  }
  const matchType = match.matchType as MatchType;

  /* 4. 사용자 정보 조회 (채팅방 제목용) */
  let userName: string | null = null;
  try {
    const rows = await db
      .select({ id: members.id, name: members.name, status: members.status })
      .from(members)
      .where(eq(members.id, match.userId))
      .limit(1);
    if (rows.length === 0) return badRequest("매칭의 사용자가 존재하지 않음");
    if (rows[0].status === "suspended" || rows[0].status === "withdrawn") {
      return badRequest(`사용자 상태가 ${rows[0].status}임 — 배정 불가`);
    }
    userName = rows[0].name;
  } catch (err) {
    return jsonError("select_user", err);
  }

  /* 5. 전문가 자격 검증 */
  let expertCheck;
  try {
    expertCheck = await checkExpertEligibility(expertId, matchType);
  } catch (err) {
    return jsonError("check_expert", err);
  }
  if (!expertCheck.ok) {
    return badRequest(`전문가 자격 검증 실패 — ${expertCheck.reason}`);
  }
  const expertName = expertCheck.member?.name ?? null;

  /* 6. 트랜잭션: 채팅방 생성 + 매칭 갱신 */
  let chatRoomId: number;
  try {
    const result = await db.transaction(async (tx) => {
      /* 6a. 채팅방 INSERT */
      const title = buildExpertChatRoomTitle(matchType, userName, expertName);
      const inserted = await tx
        .insert(chatRooms)
        .values({
          memberId: match!.userId,
          expertId: expertId,
          category: match!.sourceDomain || "expert",
          roomType: ROOM_TYPE_EXPERT,
          title,
          status: "active",
        } as any)
        .returning({ id: chatRooms.id });
      const newRoomId = inserted[0]?.id;
      if (!newRoomId) throw new Error("채팅방 생성 실패 (returning 비어있음)");

      /* 6b. expert_matches UPDATE */
      await tx
        .update(expertMatches)
        .set({
          expertId: expertId,
          chatRoomId: newRoomId,
          status: "matched",
          assignedBy: adminMemberId,
          assignedAt: new Date(),
          adminNote: adminNote ?? match!.adminNote,
          updatedAt: new Date(),
        } as any)
        .where(eq(expertMatches.id, matchId));

      return newRoomId;
    });
    chatRoomId = result;
  } catch (err) {
    return jsonError("transaction", err);
  }

  /* AD-018: 원본 신청서에 배정 반영 (신청 화면 '미배정' 잔존·중복 배정 방지) */
  try {
    const sd = match!.sourceDomain;
    const sid = match!.sourceId;
    if (sid && sd === "support") {
      await db.update(supportRequests).set({
        assignedMemberId: expertId, assignedExpertName: expertName, assignedAt: new Date(), updatedAt: new Date(),
      } as any).where(eq(supportRequests.id, sid));
    } else if (sid && sd === "legal") {
      await db.update(legalConsultations).set({
        assignedLawyerId: expertId, assignedLawyerName: expertName, assignedAt: new Date(), updatedAt: new Date(),
      } as any).where(eq(legalConsultations.id, sid));
    }
  } catch (err) { console.warn("[admin-expert-assign] 원본 신청 반영 실패:", (err as any)?.message); }

  /* AD-019: 신청자·전문가 양측 알림 (채팅방 개설 안내) — best-effort */
  const matchLabel = matchType === "lawyer" ? "변호사" : "심리상담사";
  try {
    await createNotification({
      recipientId: match!.userId, recipientType: "user", category: "support", severity: "info",
      title: `🤝 담당 ${matchLabel}가 배정되었습니다`,
      message: `${expertName || matchLabel}님과의 1:1 상담 채팅방이 개설되었습니다. 마이페이지에서 상담을 시작하세요.`,
      link: `/mypage.html#chat`, refTable: "chat_rooms", refId: chatRoomId,
    });
  } catch (err) { console.warn("[admin-expert-assign] 신청자 알림 실패:", (err as any)?.message); }
  try {
    await createNotification({
      recipientId: expertId, recipientType: "user", category: "support", severity: "info",
      title: "🤝 새 1:1 상담이 배정되었습니다",
      message: `${userName || "신청자"}님의 상담이 배정되었습니다. 상담 채팅방에서 진행해 주세요.`,
      link: `/mypage.html#chat`, refTable: "chat_rooms", refId: chatRoomId,
    });
  } catch (err) { console.warn("[admin-expert-assign] 전문가 알림 실패:", (err as any)?.message); }

  /* 7. 응답 */
  return new Response(
    JSON.stringify({
      ok: true,
      message: "전문가 배정 완료 + 채팅방 생성됨",
      data: {
        matchId,
        expertId,
        chatRoomId,
        userName,
        expertName,
        matchType,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};

export const config = { path: "/api/admin-expert-assign" };
