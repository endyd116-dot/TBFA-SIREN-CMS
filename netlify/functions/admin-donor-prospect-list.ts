/**
 * GET /api/admin/donor-prospect-list
 *
 * ★ Phase 2 (마일스톤 #16 단계 C / DESIGN_PHASE2.md §6.3): 잠재 후원자 조회 + 분류 필터
 *
 * Query:
 *   subtype?:  'onetime' | 'cancelled' | 'all'   (default 'all')
 *   q?:        string                            (이름·이메일·전화 LIKE)
 *   page?:     number                            (default 1)
 *   pageSize?: number                            (default 50, max 200)
 *
 * Response: AdminDonorProspectResponse — DESIGN_PHASE2.md §6.3 100% 일치
 *
 * 식별: members.donor_type = 'prospect'
 *   subtype             = members.prospect_subtype
 *   lastDonationDate    = donations 마지막 createdAt
 *   lastDonationAmount  = donations 마지막 amount
 *   totalDonationCount  = donations(status='completed') COUNT (정기·일시 합산)
 *   totalDonationAmount = 위 SUM
 *   cancelledChannel    = subtype='cancelled'일 때:
 *     - billing_keys.deactivated_at 존재 → 'toss'
 *     - hyosung_contract_status IN ('cancelled','suspended','expired','terminated') → 'hyosung'
 *     - 둘 다면 가장 최근 변경 채널 우선 (toss.deactivated_at vs hyosung_synced_at 비교)
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { maskPhone } from "../../lib/masking";

/* =========================================================
   API 계약 (DESIGN_PHASE2.md §6.3)
   ========================================================= */

export type DonorChannel = "toss" | "hyosung";
export type ProspectSubtype = "onetime" | "cancelled";

export interface AdminDonorProspectQuery {
  subtype?: ProspectSubtype | "all";
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminDonorProspect {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  subtype: ProspectSubtype;
  lastDonationDate: string | null;
  lastDonationAmount: number | null;
  totalDonationCount: number;
  totalDonationAmount: number;
  cancelledChannel: DonorChannel | null;
  donorEvaluatedAt: string;
}

export interface AdminDonorProspectResponse {
  ok: true;
  data: AdminDonorProspect[];
  page: number;
  pageSize: number;
  total: number;
  kpi: {
    prospectTotal: number;
    onetimeCount: number;
    cancelledCount: number;
  };
}

const CANCELLED_HYOSUNG_STATUSES = ["cancelled", "suspended", "expired", "terminated"];

/* =========================================================
   에러 응답
   ========================================================= */

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "잠재 후원자 조회 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

/* =========================================================
   메인 핸들러
   ========================================================= */

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

  /* 1. 관리자 인증 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  /* 2. 쿼리 파싱 */
  let subtype: "onetime" | "cancelled" | "all";
  let q: string;
  let page: number;
  let pageSize: number;

  try {
    const url = new URL(req.url);
    const rawSubtype = (url.searchParams.get("subtype") || "all").toLowerCase();
    subtype =
      rawSubtype === "onetime" || rawSubtype === "cancelled"
        ? (rawSubtype as ProspectSubtype)
        : "all";
    q = (url.searchParams.get("q") || "").trim().slice(0, 100);
    page = Math.max(1, Number(url.searchParams.get("page") || "1") || 1);
    pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") || "50") || 50));
  } catch (err) {
    return jsonError("parse_query", err, 400);
  }

  /* 3. 회원 페이지 조회 */
  let memberRows: any[] = [];
  let total = 0;

  try {
    const offset = (page - 1) * pageSize;
    const subtypeFilter =
      subtype === "all"
        ? sql``
        : sql`AND m.prospect_subtype = ${subtype}`;

    const qLike = q ? `%${q}%` : "";
    const qFilter = q
      ? sql`AND (m.name ILIKE ${qLike} OR m.email ILIKE ${qLike} OR m.phone ILIKE ${qLike})`
      : sql``;

    const dataResult: any = await db.execute(sql`
      SELECT
        m.id,
        m.name,
        m.email,
        m.phone,
        m.prospect_subtype,
        m.donor_evaluated_at,
        m.hyosung_contract_status,
        m.hyosung_synced_at
      FROM members m
      WHERE m.donor_type = 'prospect'
        ${subtypeFilter}
        ${qFilter}
      ORDER BY m.donor_evaluated_at DESC NULLS LAST, m.id DESC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `);
    memberRows = Array.isArray(dataResult) ? dataResult : (dataResult as any).rows || [];

    const totalResult: any = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM members m
      WHERE m.donor_type = 'prospect'
        ${subtypeFilter}
        ${qFilter}
    `);
    const totalRow = (Array.isArray(totalResult) ? totalResult[0] : (totalResult as any).rows?.[0]) || {};
    total = Number(totalRow.total) || 0;
  } catch (err) {
    return jsonError("select_members", err);
  }

  /* 빈 결과 */
  if (memberRows.length === 0) {
    let kpi = { prospectTotal: 0, onetimeCount: 0, cancelledCount: 0 };
    try {
      kpi = await fetchProspectKpi();
    } catch (err) {
      console.warn("[admin-donor-prospect-list] KPI 조회 실패", err);
    }
    return new Response(
      JSON.stringify({
        ok: true,
        message: null,
        data: { ok: true, data: [], page, pageSize, total, kpi },
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  /* 4. 보조 조회 */
  const memberIds = memberRows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0);

  /* 4-1. donations 통계 + 마지막 후원 */
  const donationStatsMap = new Map<
    number,
    { count: number; sum: number; lastDate: Date | null; lastAmount: number | null }
  >();
  try {
    const statsRs: any = await db.execute(sql`
      SELECT
        member_id,
        COUNT(*)::int AS cnt,
        COALESCE(SUM(amount), 0)::bigint AS sum
      FROM donations
      WHERE member_id = ANY(${sql.raw(`ARRAY[${memberIds.join(",") || "0"}]::int[]`)})
        AND status = 'completed'
      GROUP BY member_id
    `);
    const statsRows = Array.isArray(statsRs) ? statsRs : (statsRs as any).rows || [];
    for (const r of statsRows) {
      const mid = Number(r.member_id);
      if (!mid) continue;
      donationStatsMap.set(mid, {
        count: Number(r.cnt) || 0,
        sum: Number(r.sum) || 0,
        lastDate: null,
        lastAmount: null,
      });
    }

    /* 마지막 후원 (DISTINCT ON) */
    const lastRs: any = await db.execute(sql`
      SELECT DISTINCT ON (member_id) member_id, created_at, amount
      FROM donations
      WHERE member_id = ANY(${sql.raw(`ARRAY[${memberIds.join(",") || "0"}]::int[]`)})
        AND status = 'completed'
      ORDER BY member_id, created_at DESC
    `);
    const lastRows = Array.isArray(lastRs) ? lastRs : (lastRs as any).rows || [];
    for (const r of lastRows) {
      const mid = Number(r.member_id);
      if (!mid) continue;
      const prev = donationStatsMap.get(mid) || {
        count: 0,
        sum: 0,
        lastDate: null,
        lastAmount: null,
      };
      prev.lastDate = r.created_at ? new Date(r.created_at) : null;
      prev.lastAmount = r.amount != null ? Number(r.amount) : null;
      donationStatsMap.set(mid, prev);
    }
  } catch (err) {
    console.warn("[admin-donor-prospect-list] donations 통계 조회 실패 — 0 fallback", err);
  }

  /* 4-1b. 효성 hyosung_billings 직접 합산 (donations 적재 누락 보정 fallback)
   * confirmHyosungBilling은 received_amount > 0인 행만 donations에 INSERT.
   * 효성 CSV 받은금액이 비어있거나 0이면 donations에 안 들어감 → 누적 0으로 표시.
   * 보정: hyosung_billings 자체에서 직접 합산 + 마지막 결제일/금액 추출.
   */
  const hyosungBillingStatsMap = new Map<
    number,
    { count: number; sum: number; lastDate: Date | null; lastAmount: number | null }
  >();
  try {
    /* 합산 */
    const rs: any = await db.execute(sql`
      SELECT
        m.id AS member_id,
        COUNT(*)::int AS cnt,
        COALESCE(SUM(hb.received_amount), 0)::bigint AS sum
      FROM members m
      INNER JOIN hyosung_billings hb ON hb.member_no = m.hyosung_member_no
      WHERE m.id = ANY(${sql.raw(`ARRAY[${memberIds.join(",") || "0"}]::int[]`)})
        AND hb.received_amount IS NOT NULL
        AND hb.received_amount > 0
      GROUP BY m.id
    `);
    const rows = Array.isArray(rs) ? rs : (rs as any).rows || [];
    for (const r of rows) {
      const mid = Number(r.member_id);
      if (!mid) continue;
      hyosungBillingStatsMap.set(mid, {
        count: Number(r.cnt) || 0,
        sum: Number(r.sum) || 0,
        lastDate: null,
        lastAmount: null,
      });
    }

    /* 마지막 효성 수납 (DISTINCT ON) */
    const lastRs: any = await db.execute(sql`
      SELECT DISTINCT ON (m.id)
        m.id AS member_id,
        hb.payment_date,
        hb.received_amount
      FROM members m
      INNER JOIN hyosung_billings hb ON hb.member_no = m.hyosung_member_no
      WHERE m.id = ANY(${sql.raw(`ARRAY[${memberIds.join(",") || "0"}]::int[]`)})
        AND hb.received_amount IS NOT NULL
        AND hb.received_amount > 0
      ORDER BY m.id, hb.payment_date DESC NULLS LAST, hb.id DESC
    `);
    const lastRows = Array.isArray(lastRs) ? lastRs : (lastRs as any).rows || [];
    for (const r of lastRows) {
      const mid = Number(r.member_id);
      if (!mid) continue;
      const prev = hyosungBillingStatsMap.get(mid) || {
        count: 0, sum: 0, lastDate: null, lastAmount: null,
      };
      prev.lastDate = r.payment_date ? new Date(r.payment_date) : null;
      prev.lastAmount = r.received_amount != null ? Number(r.received_amount) : null;
      hyosungBillingStatsMap.set(mid, prev);
    }
  } catch (err) {
    console.warn("[admin-donor-prospect-list] hyosung_billings 합산 실패 — 0 fallback", err);
  }

  /* 4-2. cancelledChannel 결정용 — 토스 deactivated 정보 */
  const tossDeactMap = new Map<number, Date | null>();
  try {
    const rs: any = await db.execute(sql`
      SELECT member_id, MAX(deactivated_at) AS last_deact
      FROM billing_keys
      WHERE deactivated_at IS NOT NULL
        AND member_id = ANY(${sql.raw(`ARRAY[${memberIds.join(",") || "0"}]::int[]`)})
      GROUP BY member_id
    `);
    const rows = Array.isArray(rs) ? rs : (rs as any).rows || [];
    for (const r of rows) {
      const mid = Number(r.member_id);
      if (!mid) continue;
      tossDeactMap.set(mid, r.last_deact ? new Date(r.last_deact) : null);
    }
  } catch (err) {
    console.warn("[admin-donor-prospect-list] billing_keys deactivated 조회 실패", err);
  }

  /* 5. 응답 매핑 */
  let data: AdminDonorProspect[] = [];
  try {
    data = memberRows.map((r): AdminDonorProspect => {
      const id = Number(r.id);
      const donationsStats = donationStatsMap.get(id) || {
        count: 0, sum: 0, lastDate: null, lastAmount: null,
      };
      const hyosungStats = hyosungBillingStatsMap.get(id) || {
        count: 0, sum: 0, lastDate: null, lastAmount: null,
      };
      /* 누적은 donations와 효성 수납내역 중 큰 값 채택 — donations 적재 누락 보정.
       * 마지막 후원일/금액도 더 최근 쪽 채택. */
      const stats = (hyosungStats.count > donationsStats.count) ? hyosungStats : donationsStats;
      if (donationsStats.lastDate && hyosungStats.lastDate) {
        stats.lastDate = donationsStats.lastDate >= hyosungStats.lastDate
          ? donationsStats.lastDate
          : hyosungStats.lastDate;
        stats.lastAmount = donationsStats.lastDate >= hyosungStats.lastDate
          ? donationsStats.lastAmount
          : hyosungStats.lastAmount;
      } else {
        stats.lastDate = donationsStats.lastDate || hyosungStats.lastDate;
        stats.lastAmount = donationsStats.lastAmount ?? hyosungStats.lastAmount;
      }
      const subtypeVal = (r.prospect_subtype === "onetime" || r.prospect_subtype === "cancelled")
        ? r.prospect_subtype
        : "onetime"; // 안전 폴백 (cron이 NULL을 남기지 않지만, 만약 NULL이면 onetime으로 간주)

      let cancelledChannel: DonorChannel | null = null;
      if (subtypeVal === "cancelled") {
        const tossDeact = tossDeactMap.get(id) || null;
        const hyosungStatus = (r.hyosung_contract_status || "").toLowerCase();
        const hyosungCancelled = CANCELLED_HYOSUNG_STATUSES.includes(hyosungStatus);
        const hyosungSyncedAt = r.hyosung_synced_at ? new Date(r.hyosung_synced_at) : null;

        if (tossDeact && hyosungCancelled) {
          /* 둘 다 — 가장 최근 변경 채널 우선 */
          cancelledChannel =
            !hyosungSyncedAt || tossDeact >= hyosungSyncedAt ? "toss" : "hyosung";
        } else if (tossDeact) {
          cancelledChannel = "toss";
        } else if (hyosungCancelled) {
          cancelledChannel = "hyosung";
        } else {
          cancelledChannel = null;
        }
      }

      return {
        id,
        name: r.name || "",
        email: r.email || null,
        phone: maskPhone(r.phone),
        subtype: subtypeVal as ProspectSubtype,
        lastDonationDate: stats.lastDate ? stats.lastDate.toISOString() : null,
        lastDonationAmount: stats.lastAmount,
        totalDonationCount: stats.count,
        totalDonationAmount: stats.sum,
        cancelledChannel,
        donorEvaluatedAt: r.donor_evaluated_at
          ? new Date(r.donor_evaluated_at).toISOString()
          : new Date(0).toISOString(),
      };
    });
  } catch (err) {
    return jsonError("map", err);
  }

  /* 6. KPI */
  let kpi = { prospectTotal: 0, onetimeCount: 0, cancelledCount: 0 };
  try {
    kpi = await fetchProspectKpi();
  } catch (err) {
    console.warn("[admin-donor-prospect-list] KPI 조회 실패 — 0 fallback", err);
  }

  /* 7. 응답 */
  return new Response(
    JSON.stringify({
      ok: true,
      message: null,
      data: { ok: true, data, page, pageSize, total, kpi },
    }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};

async function fetchProspectKpi() {
  const rs: any = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE donor_type = 'prospect')::int AS prospect_total,
      COUNT(*) FILTER (WHERE donor_type = 'prospect' AND prospect_subtype = 'onetime')::int AS onetime_count,
      COUNT(*) FILTER (WHERE donor_type = 'prospect' AND prospect_subtype = 'cancelled')::int AS cancelled_count
    FROM members
  `);
  const row = (Array.isArray(rs) ? rs[0] : (rs as any).rows?.[0]) || {};
  return {
    prospectTotal: Number(row.prospect_total) || 0,
    onetimeCount: Number(row.onetime_count) || 0,
    cancelledCount: Number(row.cancelled_count) || 0,
  };
}

export const config = { path: "/api/admin/donor-prospect-list" };
