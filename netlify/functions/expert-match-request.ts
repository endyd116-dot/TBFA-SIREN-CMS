/**
 * POST /api/expert-match-request
 *
 * 6순위 #8 — 사용자가 변호사·심리상담사 매칭을 신청.
 *
 * Body: { matchType: 'lawyer'|'counselor', sourceDomain: 'incident'|'harassment'|'legal'|'support', reason: string, sourceId?: number }
 * 권한: requireActiveUser (블랙 차단 포함)
 * 중복 방지: 같은 matchType의 pending/matched/active 매칭이 이미 있으면 거절
 */

import { eq, and } from "drizzle-orm";
import { db, expertMatches } from "../../db";
import { requireActiveUser } from "../../lib/auth";
import {
  isValidMatchType,
  isValidSourceDomain,
} from "../../lib/expert-match";
import {
  ok,
  badRequest,
  corsPreflight,
  methodNotAllowed,
} from "../../lib/response";

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "매칭 신청 실패",
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

  /* 1. 사용자 인증 (블랙 차단 포함) */
  const auth = await requireActiveUser(req);
  if (!auth.ok) return auth.res;
  const uid = auth.user.uid;

  /* 2. body 파싱 */
  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return jsonError("parse_body", err);
  }

  const matchType = String(body?.matchType || "").trim();
  const sourceDomain = String(body?.sourceDomain || "").trim();
  const reason = String(body?.reason || "").trim().slice(0, 2000);
  const sourceId = body?.sourceId ? Number(body.sourceId) : null;

  if (!isValidMatchType(matchType)) {
    return badRequest("유효하지 않은 매칭 종류입니다 (lawyer 또는 counselor)");
  }
  if (!isValidSourceDomain(sourceDomain)) {
    return badRequest(
      "유효하지 않은 도메인입니다 (incident / harassment / legal / support)",
    );
  }
  if (!reason) return badRequest("신청 사유를 입력해주세요");

  /* 3. 진행 중 동일 종류 매칭 중복 방지 */
  let existing: { id: number; status: string | null }[] = [];
  try {
    existing = await db
      .select({ id: expertMatches.id, status: expertMatches.status })
      .from(expertMatches)
      .where(
        and(eq(expertMatches.userId, uid), eq(expertMatches.matchType, matchType)),
      )
      .limit(20);
    existing = existing.filter((r) =>
      ["pending", "matched", "active"].includes(r.status ?? ""),
    );
  } catch (err) {
    return jsonError("check_existing", err);
  }

  if (existing.length > 0) {
    const typeLabel = matchType === "lawyer" ? "변호사" : "심리상담사";
    return badRequest(
      `이미 진행 중인 ${typeLabel} 매칭이 있습니다 (매칭 ID: ${existing[0].id})`,
    );
  }

  /* 4. 신청 등록 */
  let match: any;
  try {
    const [inserted] = await db
      .insert(expertMatches)
      .values({
        userId: uid,
        matchType,
        sourceDomain,
        sourceId: Number.isFinite(sourceId) && sourceId! > 0 ? sourceId : null,
        reason,
        status: "pending",
      } as any)
      .returning();
    match = inserted;
  } catch (err) {
    return jsonError("insert_match", err);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      message: "매칭 신청이 접수되었습니다. 어드민 검토 후 전문가가 배정됩니다.",
      data: { match },
    }),
    { status: 201, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};

export const config = { path: "/api/expert-match-request" };
