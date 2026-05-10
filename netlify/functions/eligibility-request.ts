/**
 * 6순위 #6 — 교원 회원 자격 변경 신청 (사용자)
 *
 * POST /api/eligibility-request
 *   body: { requestedType: '현직'|'은퇴'|'예비'|'일반', reason: string, evidenceBlobId?: number }
 *
 * 절차: 회원 본인이 자격 변경을 신청 → status='pending'으로 적재 → 어드민 검토 대기.
 * 동일 회원의 pending 1건만 허용 (DB 부분 UNIQUE + 코드 사전 점검).
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireActiveUser } from "../../lib/auth";
import {
  ok, badRequest, conflict, methodNotAllowed,
  serverError, parseJson, corsPreflight,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

const ALLOWED_TYPES = ["현직", "은퇴", "예비", "일반"];

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  /* 1. 인증 + 차단 검증 */
  const _r = await requireActiveUser(req);
  if (!_r.ok) return (_r as { ok: false; res: Response }).res;
  const auth = _r.user;
  const meId = (auth as any).uid as number;

  try {
    /* 2. 입력 검증 */
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const requestedType = String(body.requestedType || "").trim();
    if (!ALLOWED_TYPES.includes(requestedType)) {
      return badRequest("자격 유형은 현직/은퇴/예비/일반 중 하나여야 합니다");
    }

    const reason = body.reason ? String(body.reason).slice(0, 2000).trim() : null;
    if (!reason || reason.length < 10) {
      return badRequest("변경 사유를 10자 이상 작성해주세요");
    }

    let evidenceBlobId: number | null = null;
    if (body.evidenceBlobId !== undefined && body.evidenceBlobId !== null && body.evidenceBlobId !== "") {
      const n = Number(body.evidenceBlobId);
      if (Number.isFinite(n) && n > 0) evidenceBlobId = n;
    }

    /* 3. 현재 자격 + pending 중복 체크 */
    const meRows: any = await db.execute(sql`
      SELECT id, name, eligibility_type AS "eligibilityType"
        FROM members
       WHERE id = ${meId}
       LIMIT 1
    `);
    const me = (Array.isArray(meRows) ? meRows : meRows.rows || [])[0];
    if (!me) return badRequest("회원 정보를 찾을 수 없습니다");

    const currentType = me.eligibilityType ?? null;
    if (currentType && currentType === requestedType) {
      return badRequest("현재 자격과 동일합니다");
    }

    const pendingRows: any = await db.execute(sql`
      SELECT id FROM eligibility_change_requests
       WHERE member_id = ${meId} AND status = 'pending'
       LIMIT 1
    `);
    const pendingArr = Array.isArray(pendingRows) ? pendingRows : pendingRows.rows || [];
    if (pendingArr.length > 0) {
      return conflict("이미 검토 대기 중인 자격 변경 신청이 있습니다");
    }

    /* 4. INSERT */
    const insRows: any = await db.execute(sql`
      INSERT INTO eligibility_change_requests
        (member_id, current_type, requested_type, reason, evidence_blob_id, status)
      VALUES
        (${meId}, ${currentType}, ${requestedType}, ${reason}, ${evidenceBlobId}, 'pending')
      RETURNING id, member_id AS "memberId",
                current_type AS "currentType",
                requested_type AS "requestedType",
                reason,
                evidence_blob_id AS "evidenceBlobId",
                status,
                created_at AS "createdAt"
    `);
    const inserted = (Array.isArray(insRows) ? insRows : insRows.rows || [])[0];

    /* 5. 감사 로그 */
    await logUserAction(req, meId, me.name, "eligibility.request", {
      target: `eligibility:${inserted?.id}`,
      detail: { currentType, requestedType, evidenceBlobId },
    });

    return ok(inserted, "자격 변경 신청이 접수되었습니다. 검토 후 결과를 알려드립니다.");
  } catch (err: any) {
    console.error("[eligibility-request]", err);
    /* 부분 UNIQUE 위반(동시 요청)도 conflict로 안내 */
    const msg = String(err?.message || "");
    if (msg.includes("eligibility_req_pending_unique")) {
      return conflict("이미 검토 대기 중인 자격 변경 신청이 있습니다");
    }
    return serverError("자격 변경 신청 중 오류", err);
  }
};

export const config = { path: "/api/eligibility-request" };
