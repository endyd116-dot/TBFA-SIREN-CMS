/**
 * 6순위 #6 — 어드민: 자격 변경 신청 목록
 *
 * GET /api/admin-eligibility-list
 *   query:
 *     - status : 'pending' | 'approved' | 'rejected' | 'all'  (기본 pending)
 *     - limit  : 1~500 (기본 200)
 *
 *  응답:
 *     items[]                                   — JOIN으로 회원명·이메일·전화 포함
 *     counts: { pending, approved, rejected }   — 사이드바 뱃지용
 *
 *  ⚠️ leftJoin 체인은 안정성 위험(CLAUDE.md §6.3) → 별도 SELECT + JS Map 매칭.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members } from "../../db/schema";
import { inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, methodNotAllowed, serverError,
} from "../../lib/response";
import { maskPhone } from "../../lib/masking";

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") return methodNotAllowed();
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;

  try {
    const url = new URL(req.url);
    const statusRaw = (url.searchParams.get("status") || "pending").toLowerCase();
    const allowed = ["pending", "approved", "rejected", "all"];
    if (!allowed.includes(statusRaw)) return badRequest("status 값 오류");

    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)));

    /* 1. 신청 목록 */
    let rows: any;
    if (statusRaw === "all") {
      rows = await db.execute(sql`
        SELECT id,
               member_id        AS "memberId",
               current_type     AS "currentType",
               requested_type   AS "requestedType",
               reason,
               evidence_blob_id AS "evidenceBlobId",
               status,
               admin_note       AS "adminNote",
               reviewed_by      AS "reviewedBy",
               reviewed_at      AS "reviewedAt",
               created_at       AS "createdAt",
               updated_at       AS "updatedAt"
          FROM eligibility_change_requests
         ORDER BY
           CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
           created_at DESC
         LIMIT ${limit}
      `);
    } else {
      rows = await db.execute(sql`
        SELECT id,
               member_id        AS "memberId",
               current_type     AS "currentType",
               requested_type   AS "requestedType",
               reason,
               evidence_blob_id AS "evidenceBlobId",
               status,
               admin_note       AS "adminNote",
               reviewed_by      AS "reviewedBy",
               reviewed_at      AS "reviewedAt",
               created_at       AS "createdAt",
               updated_at       AS "updatedAt"
          FROM eligibility_change_requests
         WHERE status = ${statusRaw}
         ORDER BY created_at DESC
         LIMIT ${limit}
      `);
    }
    const items: any[] = Array.isArray(rows) ? rows : rows.rows || [];

    /* 2. 회원 정보 매칭 */
    const memberIds = Array.from(new Set(items.map((r) => r.memberId).filter(Boolean)));
    const reviewerIds = Array.from(new Set(items.map((r) => r.reviewedBy).filter(Boolean)));
    const allIds = Array.from(new Set([...memberIds, ...reviewerIds]));

    const memberMap = new Map<number, any>();
    if (allIds.length > 0) {
      const mRows: any = await db
        .select({
          id: members.id,
          name: members.name,
          email: members.email,
          phone: members.phone,
          type: members.type,
        })
        .from(members)
        .where(inArray(members.id, allIds as number[]));
      for (const m of mRows) memberMap.set(m.id, m);
    }

    const enriched = items.map((r) => {
      const m = memberMap.get(r.memberId) || null;
      const reviewer = r.reviewedBy ? memberMap.get(r.reviewedBy) : null;
      return {
        ...r,
        member: m
          ? { id: m.id, name: m.name, email: m.email, phone: maskPhone(m.phone), type: m.type }
          : null,
        reviewer: reviewer ? { id: reviewer.id, name: reviewer.name } : null,
      };
    });

    /* 3. 통계 */
    const countRows: any = await db.execute(sql`
      SELECT status, COUNT(*)::int AS cnt
        FROM eligibility_change_requests
       GROUP BY status
    `);
    const counts: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const c of (Array.isArray(countRows) ? countRows : countRows.rows || [])) {
      if (c.status in counts) counts[c.status] = Number(c.cnt) || 0;
    }

    return ok({ items: enriched, counts, total: enriched.length });
  } catch (err: any) {
    console.error("[admin-eligibility-list]", err);
    return serverError("자격 변경 목록 조회 중 오류", err);
  }
};

export const config = { path: "/api/admin-eligibility-list" };
