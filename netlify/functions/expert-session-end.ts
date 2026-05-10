/**
 * POST /api/expert-session-end
 *
 * 6순위 #8 — 1:1 매칭 세션 종료.
 * 어드민 또는 해당 전문가(expertId)만 종료 가능.
 *
 * Body: { matchId: number, closedReason?: 'completed'|'expert_unavailable'|'user_canceled'|'admin_terminated' }
 *
 * 흐름:
 *   1. 어드민 JWT 또는 사용자 JWT (블랙 차단 포함) 인증
 *   2. 매칭 행 조회 — 이미 closed/rejected면 거절
 *   3. 권한 확인 — 어드민 OR match.expertId === uid
 *   4. 트랜잭션:
 *      a. expert_matches → status='closed', closedAt, closedReason
 *      b. chat_rooms → status='closed', closedAt, closedBy (chatRoomId가 있는 경우)
 */

import { eq } from "drizzle-orm";
import { db, expertMatches, chatRooms } from "../../db";
import { authenticateAdmin, requireActiveUser } from "../../lib/auth";
import {
  CLOSED_REASONS,
  isValidClosedReason,
} from "../../lib/expert-match";
import {
  ok,
  badRequest,
  forbidden,
  corsPreflight,
  methodNotAllowed,
} from "../../lib/response";

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "세션 종료 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  /* 1. 인증 — 어드민 우선, 없으면 사용자(전문가) */
  const adminAuth = authenticateAdmin(req);
  let viewerMemberId: number;
  let isAdmin = false;

  if (adminAuth) {
    viewerMemberId = adminAuth.uid;
    isAdmin = true;
  } else {
    const userAuth = await requireActiveUser(req);
    if (!userAuth.ok) return (userAuth as { ok: false; res: Response }).res;
    viewerMemberId = userAuth.user.uid;
  }

  /* 2. body 파싱 */
  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return jsonError("parse_body", err);
  }

  const matchId = Number(body?.matchId);
  const closedReasonRaw = body?.closedReason
    ? String(body.closedReason).trim()
    : "completed";

  if (!Number.isInteger(matchId) || matchId <= 0) {
    return badRequest("matchId가 유효하지 않습니다");
  }
  if (!isValidClosedReason(closedReasonRaw)) {
    return badRequest(
      `유효하지 않은 종료 사유입니다 (${CLOSED_REASONS.join(" | ")})`,
    );
  }
  const closedReason = closedReasonRaw;

  /* 3. 매칭 조회 */
  let match: any;
  try {
    const rows = await db
      .select({
        id: expertMatches.id,
        expertId: expertMatches.expertId,
        chatRoomId: expertMatches.chatRoomId,
        status: expertMatches.status,
      })
      .from(expertMatches)
      .where(eq(expertMatches.id, matchId))
      .limit(1);
    match = rows[0];
  } catch (err) {
    return jsonError("select_match", err);
  }

  if (!match) return badRequest("매칭을 찾을 수 없습니다");

  if (match.status === "closed" || match.status === "rejected") {
    return badRequest(`이미 종료된 매칭입니다 (status=${match.status})`);
  }
  if (match.status === "pending") {
    return badRequest(
      "아직 전문가가 배정되지 않은 매칭입니다. 어드민 배정 후 종료할 수 있습니다.",
    );
  }

  /* 4. 권한 확인 — 어드민 OR 해당 전문가 */
  if (!isAdmin && match.expertId !== viewerMemberId) {
    return forbidden("해당 매칭의 세션을 종료할 권한이 없습니다");
  }

  /* 5. 트랜잭션 — 매칭 상태 + 채팅방 상태 동시 갱신 */
  try {
    await db.transaction(async (tx) => {
      /* 5a. expert_matches 종료 */
      await tx
        .update(expertMatches)
        .set({
          status: "closed",
          closedAt: new Date(),
          closedReason,
          updatedAt: new Date(),
        } as any)
        .where(eq(expertMatches.id, matchId));

      /* 5b. 연결된 채팅방도 종료 (있는 경우만) */
      if (match!.chatRoomId) {
        await tx
          .update(chatRooms)
          .set({
            status: "closed",
            closedAt: new Date(),
            closedBy: viewerMemberId,
            updatedAt: new Date(),
          } as any)
          .where(eq(chatRooms.id, match!.chatRoomId));
      }
    });
  } catch (err) {
    return jsonError("transaction", err);
  }

  return ok(
    { matchId, closedReason, chatRoomId: match.chatRoomId ?? null },
    "세션이 종료되었습니다",
  );
};

export const config = { path: "/api/expert-session-end" };
