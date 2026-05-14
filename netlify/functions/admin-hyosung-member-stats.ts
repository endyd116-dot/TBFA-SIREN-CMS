/**
 * GET /api/admin-hyosung-member-stats
 *
 * 효성 CMS+ 대시보드 — 유족회원·후원회원 통계 KPI.
 * 버그픽스 #1: 효성 계약(hyosung_contracts) ↔ members JOIN 으로 집계.
 *
 * 응답:
 *   ok: true,
 *   data: {
 *     contractTotal:     number,  // 효성 계약 총 건수
 *     contractLinked:    number,  // members 와 연결된 계약 (linked_member_id 존재)
 *     contractUnlinked:  number,  // 아직 회원 매칭 안 된 계약
 *     familyMembers:     number,  // 효성 계약 회원 중 members.type='family' (유족회원)
 *     regularMembers:    number,  // 효성 계약 회원 중 members.type='regular'
 *     volunteerMembers:  number,  // 효성 계약 회원 중 members.type='volunteer'
 *     activeDonors:      number,  // 효성 계약 회원 중 실제 후원중 (완료된 정기 후원 이력 있음)
 *     inactiveDonors:    number,  // 효성 계약 회원 중 완료 후원 이력 없음
 *     contractActive:    number,  // contract_status 활성 계약 건수
 *   }
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { getCache, setCache } from "../../lib/cache";

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "효성 회원 통계 조회 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const CACHE_KEY = "hyosung-member-stats-v1";
  const CACHE_TTL = 10 * 60; // 10분

  const cached = await getCache<Record<string, number>>(CACHE_KEY);
  if (cached) {
    return new Response(
      JSON.stringify({ ok: true, message: null, data: cached }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  /* 효성 계약 ↔ members LEFT JOIN ↔ donations 완료후원 집계.
   * - 계약 기준 전체/연결/미연결
   * - 연결된 회원의 type 별 (family/regular/volunteer)
   * - 연결된 회원 중 완료된 정기 후원 이력 보유 여부 */
  try {
    const rs: any = await db.execute(sql`
      WITH linked AS (
        SELECT
          hc.id                          AS contract_id,
          hc.linked_member_id            AS member_id,
          hc.contract_status             AS contract_status,
          m.type                         AS member_type,
          EXISTS (
            SELECT 1 FROM donations d
            WHERE d.member_id = m.id
              AND d.status = 'completed'
          )                              AS has_completed_donation
        FROM hyosung_contracts hc
        LEFT JOIN members m ON m.id = hc.linked_member_id
      )
      SELECT
        COUNT(*)::int                                                                AS contract_total,
        COUNT(*) FILTER (WHERE member_id IS NOT NULL)::int                            AS contract_linked,
        COUNT(*) FILTER (WHERE member_id IS NULL)::int                                AS contract_unlinked,
        COUNT(*) FILTER (WHERE member_type = 'family')::int                           AS family_members,
        COUNT(*) FILTER (WHERE member_type = 'regular')::int                          AS regular_members,
        COUNT(*) FILTER (WHERE member_type = 'volunteer')::int                        AS volunteer_members,
        COUNT(*) FILTER (WHERE member_id IS NOT NULL AND has_completed_donation)::int  AS active_donors,
        COUNT(*) FILTER (WHERE member_id IS NOT NULL AND NOT has_completed_donation)::int AS inactive_donors,
        COUNT(*) FILTER (WHERE contract_status IN ('active','정상','유지','진행'))::int AS contract_active
      FROM linked
    `);
    const row = (Array.isArray(rs) ? rs[0] : (rs as any).rows?.[0]) || {};

    const data = {
      contractTotal:    Number(row.contract_total)    || 0,
      contractLinked:   Number(row.contract_linked)   || 0,
      contractUnlinked: Number(row.contract_unlinked) || 0,
      familyMembers:    Number(row.family_members)    || 0,
      regularMembers:   Number(row.regular_members)   || 0,
      volunteerMembers: Number(row.volunteer_members) || 0,
      activeDonors:     Number(row.active_donors)     || 0,
      inactiveDonors:   Number(row.inactive_donors)   || 0,
      contractActive:   Number(row.contract_active)   || 0,
    };

    await setCache(CACHE_KEY, data, CACHE_TTL);

    return new Response(
      JSON.stringify({ ok: true, message: null, data }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (err) {
    return jsonError("hyosung_member_stats", err);
  }
};

export const config = { path: "/api/admin-hyosung-member-stats" };
