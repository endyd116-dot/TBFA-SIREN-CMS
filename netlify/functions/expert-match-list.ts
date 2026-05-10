/**
 * GET /api/expert-match-list
 *
 * 6순위 #8 — 본인 매칭 내역 조회.
 * 사용자(userId = uid) 및 전문가(expertId = uid) 모두 자신 관련 매칭을 볼 수 있음.
 *
 * 권한: requireActiveUser
 * 응답: { active: [...], closed: [...] }  — active = pending/matched/active, closed = closed/rejected
 */

import { or, eq, desc } from "drizzle-orm";
import { inArray } from "drizzle-orm";
import { db, expertMatches, members } from "../../db";
import { requireActiveUser } from "../../lib/auth";
import { ok, corsPreflight, methodNotAllowed } from "../../lib/response";

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "매칭 내역 조회 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  /* 1. 사용자 인증 */
  const auth = await requireActiveUser(req);
  if (!auth.ok) return auth.res;
  const uid = auth.user.uid;

  /* 2. 본인이 신청자(userId) 또는 배정 전문가(expertId)인 매칭 조회 */
  let rows: any[];
  try {
    rows = await db
      .select({
        id: expertMatches.id,
        userId: expertMatches.userId,
        expertId: expertMatches.expertId,
        matchType: expertMatches.matchType,
        sourceDomain: expertMatches.sourceDomain,
        sourceId: expertMatches.sourceId,
        chatRoomId: expertMatches.chatRoomId,
        status: expertMatches.status,
        reason: expertMatches.reason,
        adminNote: expertMatches.adminNote,
        assignedAt: expertMatches.assignedAt,
        closedAt: expertMatches.closedAt,
        closedReason: expertMatches.closedReason,
        createdAt: expertMatches.createdAt,
        updatedAt: expertMatches.updatedAt,
      })
      .from(expertMatches)
      .where(or(eq(expertMatches.userId, uid), eq(expertMatches.expertId, uid)))
      .orderBy(desc(expertMatches.createdAt))
      .limit(100);
  } catch (err) {
    return jsonError("select_matches", err);
  }

  if (rows.length === 0) {
    return ok({ active: [], closed: [] });
  }

  /* 3. 회원 이름 별도 조회 (drizzle 다중 leftJoin 체인 금지 규칙) */
  const memberIds = [
    ...new Set([
      ...rows.map((r) => r.userId),
      ...rows.map((r) => r.expertId).filter((id): id is number => typeof id === "number"),
    ]),
  ];

  const memberMap = new Map<number, { name: string | null }>();
  try {
    if (memberIds.length > 0) {
      const memberRows = await db
        .select({ id: members.id, name: members.name })
        .from(members)
        .where(inArray(members.id, memberIds));
      for (const m of memberRows) memberMap.set(m.id, { name: m.name });
    }
  } catch (err) {
    console.warn("[expert-match-list] 회원 이름 조회 실패:", String(err));
  }

  /* 4. 이름 합치기 + active/closed 분리 */
  const enriched = rows.map((r) => ({
    ...r,
    userName: memberMap.get(r.userId)?.name ?? null,
    expertName: r.expertId != null ? (memberMap.get(r.expertId)?.name ?? null) : null,
    isMyRequest: r.userId === uid,    // 내가 신청자인지 전문가로 배정된 건인지 구분
    isMyAssignment: r.expertId === uid,
  }));

  const active = enriched.filter((r) =>
    ["pending", "matched", "active"].includes(r.status ?? ""),
  );
  const closed = enriched.filter((r) =>
    ["closed", "rejected"].includes(r.status ?? ""),
  );

  return ok({ active, closed });
};

export const config = { path: "/api/expert-match-list" };
