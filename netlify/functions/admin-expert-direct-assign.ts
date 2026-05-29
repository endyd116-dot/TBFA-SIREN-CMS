/**
 * POST /api/admin-expert-direct-assign
 *
 * 어드민이 유가족지원/법률지원 신청 목록에서 직접 전문가 배정.
 * (기존 admin-expert-assign.ts는 pending expert_match 행이 먼저 있어야 함)
 * 본 API는 expert_match 생성 + 즉시 배정 + 채팅방 생성을 한 번에 처리.
 *
 * Body:
 *   sourceType : 'support' | 'legal'
 *   sourceId   : number (support_requests.id 또는 legal_consultations.id)
 *   userId     : number (신청한 회원 id)
 *   matchType  : 'lawyer' | 'counselor'
 *   expertId   : number (배정할 전문가 members.id)
 *   adminNote? : string
 */

import { eq, and, notInArray, desc } from "drizzle-orm";
import { db, members, chatRooms, expertMatches } from "../../db";
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

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "직접 배정 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

function badRequest(msg: string) {
  return new Response(
    JSON.stringify({ ok: false, error: msg, step: "validate" }),
    { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

const VALID_SOURCE_TYPES = ["support", "legal"] as const;

export default async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
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
  let body: {
    sourceType?: string;
    sourceId?: number;
    userId?: number;
    matchType?: string;
    expertId?: number;
    adminNote?: string;
  };
  try {
    body = await req.json();
  } catch (err) {
    return jsonError("parse_body", err, 400);
  }

  const sourceType = String(body.sourceType || "");
  const sourceId = Number(body.sourceId);
  const userId = Number(body.userId);
  const matchType = String(body.matchType || "");
  const expertId = Number(body.expertId);
  const adminNote = body.adminNote ? String(body.adminNote).slice(0, 1000) : null;

  if (!VALID_SOURCE_TYPES.includes(sourceType as any)) {
    return badRequest("sourceType은 'support' 또는 'legal'이어야 합니다");
  }
  if (!Number.isInteger(sourceId) || sourceId <= 0) return badRequest("sourceId 유효하지 않음");
  if (!Number.isInteger(userId) || userId <= 0) return badRequest("userId 유효하지 않음");
  if (!isValidMatchType(matchType)) return badRequest("matchType은 'lawyer' 또는 'counselor'이어야 합니다");
  if (!Number.isInteger(expertId) || expertId <= 0) return badRequest("expertId 유효하지 않음");

  const sourceDomain = sourceType; // 'support' | 'legal'

  /* 3. 중복 체크 — 같은 sourceId에 진행 중인(종료/거절 제외) 매칭이 있으면 차단
     (Q2-016: 정렬·상태필터 없는 limit(1)은 임의 1건만 보아 활성 매칭이 있어도 통과 가능.
      종료 상태(closed/rejected)를 WHERE에서 제외하고 최신순 1건으로 활성 건만 판정) */
  try {
    const existing = await db
      .select({ id: expertMatches.id, status: expertMatches.status })
      .from(expertMatches)
      .where(
        and(
          eq(expertMatches.sourceId, sourceId),
          eq(expertMatches.sourceDomain, sourceDomain),
          eq(expertMatches.userId, userId),
          notInArray(expertMatches.status, ["closed", "rejected"]),
        ),
      )
      .orderBy(desc(expertMatches.createdAt))
      .limit(1);
    if (existing.length > 0) {
      return badRequest(
        `이미 진행 중인 매칭이 있습니다 (match_id=${existing[0].id}, status=${existing[0].status})`,
      );
    }
  } catch (err) {
    return jsonError("check_duplicate", err);
  }

  /* 4. 사용자 유효성 확인 */
  let userName: string | null = null;
  try {
    const rows = await db
      .select({ id: members.id, name: members.name, status: members.status })
      .from(members)
      .where(eq(members.id, userId))
      .limit(1);
    if (rows.length === 0) return badRequest("해당 사용자가 존재하지 않음");
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
    expertCheck = await checkExpertEligibility(expertId, matchType as MatchType);
  } catch (err) {
    return jsonError("check_expert", err);
  }
  if (!expertCheck.ok) return badRequest(`전문가 자격 검증 실패 — ${expertCheck.reason}`);
  const expertName = expertCheck.member?.name ?? null;

  /* 6. 트랜잭션: expert_match INSERT(matched) + chat_room INSERT */
  let matchId: number;
  let chatRoomId: number;
  try {
    const result = await db.transaction(async (tx) => {
      /* 6a. 채팅방 생성 */
      const title = buildExpertChatRoomTitle(matchType as MatchType, userName, expertName);
      const roomRows = await tx
        .insert(chatRooms)
        .values({
          memberId: userId,
          expertId: expertId,
          category: sourceDomain,
          roomType: ROOM_TYPE_EXPERT,
          title,
          status: "active",
        } as any)
        .returning({ id: chatRooms.id });
      const newRoomId = roomRows[0]?.id;
      if (!newRoomId) throw new Error("채팅방 생성 실패");

      /* 6b. expert_match INSERT (status='matched' — 대기 없이 즉시 배정) */
      const matchRows = await tx
        .insert(expertMatches)
        .values({
          userId,
          expertId,
          matchType,
          sourceDomain,
          sourceId,
          chatRoomId: newRoomId,
          status: "matched",
          adminNote: adminNote ?? null,
          assignedBy: adminMemberId,
          assignedAt: new Date(),
        } as any)
        .returning({ id: expertMatches.id });
      const newMatchId = matchRows[0]?.id;
      if (!newMatchId) throw new Error("매칭 행 생성 실패");

      return { matchId: newMatchId, chatRoomId: newRoomId };
    });
    matchId = result.matchId;
    chatRoomId = result.chatRoomId;
  } catch (err) {
    return jsonError("transaction", err);
  }

  /* 7. AD-018: 원본 신청서에 배정 반영 (안 하면 신청 화면에 계속 '미배정'으로 남아 중복 배정 유발) */
  try {
    if (sourceDomain === "support") {
      await db.update(supportRequests).set({
        assignedMemberId: expertId,
        assignedExpertName: expertName,
        assignedAt: new Date(),
        updatedAt: new Date(),
      } as any).where(eq(supportRequests.id, sourceId));
    } else if (sourceDomain === "legal") {
      await db.update(legalConsultations).set({
        assignedLawyerId: expertId,
        assignedLawyerName: expertName,
        assignedAt: new Date(),
        updatedAt: new Date(),
      } as any).where(eq(legalConsultations.id, sourceId));
    }
  } catch (err) {
    console.warn("[admin-expert-direct-assign] 원본 신청 반영 실패:", (err as any)?.message);
  }

  /* 8. AD-019: 신청자·전문가 양측 알림 (채팅방 개설 안내) — best-effort, 응답 흐름 비방해 */
  const matchLabel = matchType === "lawyer" ? "변호사" : "심리상담사";
  try {
    await createNotification({
      recipientId: userId,
      recipientType: "user",
      category: "support",
      severity: "info",
      title: `🤝 담당 ${matchLabel}가 배정되었습니다`,
      message: `${expertName || matchLabel}님과의 1:1 상담 채팅방이 개설되었습니다. 마이페이지에서 상담을 시작하세요.`,
      link: `/mypage.html#chat`,
      refTable: "chat_rooms",
      refId: chatRoomId,
    });
  } catch (err) { console.warn("[admin-expert-direct-assign] 신청자 알림 실패:", (err as any)?.message); }
  try {
    await createNotification({
      recipientId: expertId,
      recipientType: "user",
      category: "support",
      severity: "info",
      title: "🤝 새 1:1 상담이 배정되었습니다",
      message: `${userName || "신청자"}님의 상담이 배정되었습니다. 상담 채팅방에서 진행해 주세요.`,
      link: `/mypage.html#chat`,
      refTable: "chat_rooms",
      refId: chatRoomId,
    });
  } catch (err) { console.warn("[admin-expert-direct-assign] 전문가 알림 실패:", (err as any)?.message); }

  return new Response(
    JSON.stringify({
      ok: true,
      message: "전문가 직접 배정 완료 + 채팅방 생성됨",
      data: { matchId, chatRoomId, expertId, userId, expertName, userName, matchType, sourceDomain },
    }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};

export const config = { path: "/api/admin-expert-direct-assign" };
