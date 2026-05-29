/**
 * GET /api/admin-expert-list
 *
 * 6순위 #8 — 어드민 전용 매칭 대기·진행·완료 목록 조회.
 *
 * Query:
 *   status = pending | matched | active | closed | rejected | all  (기본 pending)
 *   page   = 1, 2, ...   (기본 1)
 *   limit  = 1~100        (기본 20)
 *
 * 권한: requireAdmin
 * 응답: { matches: [...], total: number, page, limit }
 *   - 각 match에 userName, expertName 포함 (별도 조회)
 */

import { eq, desc, sql } from "drizzle-orm";
import { inArray } from "drizzle-orm";
import { db, expertMatches, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok,
  badRequest,
  corsPreflight,
  methodNotAllowed,
} from "../../lib/response";
import { EXPERT_MATCH_STATUSES } from "../../lib/expert-match";

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "매칭 목록 조회 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

const VALID_STATUSES: string[] = [...EXPERT_MATCH_STATUSES, "all"];

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  /* 1. 어드민 인증 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  /* 2. 쿼리 파라미터 파싱 */
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") || "pending";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));
  const offset = (page - 1) * limit;

  if (!VALID_STATUSES.includes(statusParam)) {
    return badRequest(
      `유효하지 않은 상태 필터입니다 (${VALID_STATUSES.join(" | ")})`,
    );
  }

  /* 3. 매칭 목록 조회 (조건부 where) */
  let rows: any[];
  let totalCount = 0;
  try {
    const baseSelect = {
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
      assignedBy: expertMatches.assignedBy,
      assignedAt: expertMatches.assignedAt,
      closedAt: expertMatches.closedAt,
      closedReason: expertMatches.closedReason,
      createdAt: expertMatches.createdAt,
      updatedAt: expertMatches.updatedAt,
    };

    if (statusParam === "all") {
      rows = await db
        .select(baseSelect)
        .from(expertMatches)
        .orderBy(desc(expertMatches.createdAt))
        .limit(limit)
        .offset(offset);

      const [cnt] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(expertMatches);
      totalCount = cnt?.count ?? 0;
    } else {
      rows = await db
        .select(baseSelect)
        .from(expertMatches)
        .where(eq(expertMatches.status, statusParam))
        .orderBy(desc(expertMatches.createdAt))
        .limit(limit)
        .offset(offset);

      const [cnt] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(expertMatches)
        .where(eq(expertMatches.status, statusParam));
      totalCount = cnt?.count ?? 0;
    }
  } catch (err) {
    return jsonError("select_matches", err);
  }

  /* 4. 회원 이름 별도 조회 */
  const memberIds = [
    ...new Set([
      ...rows.map((r) => r.userId),
      ...rows.map((r) => r.expertId).filter((id): id is number => typeof id === "number"),
      ...rows.map((r) => r.assignedBy).filter((id): id is number => typeof id === "number"),
    ]),
  ];

  const memberMap = new Map<number, { name: string | null; type: string | null; memberSubtype: string | null }>();
  try {
    if (memberIds.length > 0) {
      const memberRows = await db
        .select({
          id: members.id,
          name: members.name,
          type: members.type,
          memberSubtype: members.memberSubtype,
        })
        .from(members)
        .where(inArray(members.id, memberIds));
      for (const m of memberRows) {
        memberMap.set(m.id, {
          name: m.name,
          type: m.type,
          memberSubtype: m.memberSubtype,
        });
      }
    }
  } catch (err) {
    console.warn("[admin-expert-list] 회원 이름 조회 실패:", String(err));
  }

  /* 5. 이름 합치기 */
  const matches = rows.map((r) => ({
    ...r,
    userName: memberMap.get(r.userId)?.name ?? null,
    expertName: r.expertId != null ? (memberMap.get(r.expertId)?.name ?? null) : null,
    assignedByName:
      r.assignedBy != null ? (memberMap.get(r.assignedBy)?.name ?? null) : null,
  }));

  /* AD-055: 상태별 건수(특히 pending) — 클라이언트 대기 배지가 counts.pending을 읽는데
     서버가 미제공해 항상 0이던 문제 해소. 현재 필터와 무관하게 전체 상태 집계. */
  const counts: Record<string, number> = {};
  try {
    const cntRows: any = await db
      .select({ status: expertMatches.status, n: sql<number>`count(*)::int` })
      .from(expertMatches)
      .groupBy(expertMatches.status);
    for (const c of (cntRows || [])) counts[String(c.status)] = Number(c.n);
  } catch (err) {
    console.warn("[admin-expert-list] counts 집계 실패:", String(err));
  }

  return ok({ matches, total: totalCount, page, limit, counts });
};

export const config = { path: "/api/admin-expert-list" };
