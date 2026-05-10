/**
 * 6순위 #6 — 교원 회원 자격 변경: 본인 신청 내역 조회
 *
 * GET /api/eligibility-status
 *   응답:
 *     - currentType : members.eligibility_type (현재 자격)
 *     - hasPending  : 검토 대기 신청 보유 여부
 *     - items[]     : 본인 신청 이력 (최신순, 최대 50건)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireActiveUser } from "../../lib/auth";
import {
  ok, methodNotAllowed, serverError, corsPreflight,
} from "../../lib/response";

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const _r = await requireActiveUser(req);
  if (!_r.ok) return (_r as { ok: false; res: Response }).res;
  const meId = (_r.user as any).uid as number;

  try {
    /* 1. 현재 자격 */
    const meRows: any = await db.execute(sql`
      SELECT eligibility_type AS "eligibilityType"
        FROM members
       WHERE id = ${meId}
       LIMIT 1
    `);
    const currentType =
      (Array.isArray(meRows) ? meRows : meRows.rows || [])[0]?.eligibilityType ?? null;

    /* 2. 신청 이력 (최신 50건) */
    const itemsRows: any = await db.execute(sql`
      SELECT id,
             current_type   AS "currentType",
             requested_type AS "requestedType",
             reason,
             evidence_blob_id AS "evidenceBlobId",
             status,
             admin_note    AS "adminNote",
             reviewed_at   AS "reviewedAt",
             created_at    AS "createdAt",
             updated_at    AS "updatedAt"
        FROM eligibility_change_requests
       WHERE member_id = ${meId}
       ORDER BY created_at DESC
       LIMIT 50
    `);
    const items = Array.isArray(itemsRows) ? itemsRows : itemsRows.rows || [];

    const hasPending = items.some((r: any) => r.status === "pending");

    return ok({ currentType, hasPending, items });
  } catch (err: any) {
    console.error("[eligibility-status]", err);
    return serverError("자격 변경 내역 조회 중 오류", err);
  }
};

export const config = { path: "/api/eligibility-status" };
