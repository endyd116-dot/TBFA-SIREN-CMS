/**
 * GET /api/admin/donor-regular-list
 *
 * ★ Phase 2 (마일스톤 #16 단계 C / DESIGN_PHASE2.md §6.2): 정기 후원자 조회 + 채널별 KPI
 *
 * Query:
 *   channel?:  'toss' | 'hyosung' | 'all'   (default 'all')
 *   q?:        string                       (이름·이메일·전화 LIKE)
 *   page?:     number                       (default 1)
 *   pageSize?: number                       (default 50, max 200)
 *
 * Response: AdminDonorRegularResponse — DESIGN_PHASE2.md §6.2 100% 일치
 *
 * 식별: members.donor_type = 'regular'
 *   regularAmount    = 토스 active billing_keys.amount + 효성 contracts.product_amount(active만) 합산
 *   nextBillingDate  = members.next_billing_date (토스) 또는 billing_keys.next_charge_at fallback
 *   cumulativeMonths = donations(type='regular', status='completed') COUNT
 *   cumulativeAmount = 위 SUM
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

/* =========================================================
   API 계약 (DESIGN_PHASE2.md §6.2)
   ========================================================= */

export type DonorChannel = "toss" | "hyosung";

export interface AdminDonorRegularQuery {
  channel?: DonorChannel | "all";
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminDonorRegular {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  channels: DonorChannel[];
  regularAmount: number | null;
  nextBillingDate: string | null;
  cumulativeMonths: number;
  cumulativeAmount: number;
  donorEvaluatedAt: string;
}

export interface AdminDonorRegularResponse {
  ok: true;
  data: AdminDonorRegular[];
  page: number;
  pageSize: number;
  total: number;
  kpi: {
    regularTotal: number;
    tossCount: number;
    hyosungCount: number;
    bothCount: number;
    monthlyAmountSum: number;
  };
}

/* =========================================================
   에러 응답 (CLAUDE.md §6.2 단계별 try/catch + step·detail·stack)
   ========================================================= */

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "정기 후원자 조회 실패",
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
  let channel: "toss" | "hyosung" | "all";
  let q: string;
  let page: number;
  let pageSize: number;

  try {
    const url = new URL(req.url);
    const rawChannel = (url.searchParams.get("channel") || "all").toLowerCase();
    channel =
      rawChannel === "toss" || rawChannel === "hyosung" ? (rawChannel as DonorChannel) : "all";
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
    const channelFilter =
      channel === "toss"
        ? sql`AND m.donor_channels @> '["toss"]'::jsonb`
        : channel === "hyosung"
          ? sql`AND m.donor_channels @> '["hyosung"]'::jsonb`
          : sql``;

    const qLike = q ? `%${q}%` : "";
    const qFilter = q
      ? sql`AND (m.name ILIKE ${qLike} OR m.email ILIKE ${qLike} OR m.phone ILIKE ${qLike})`
      : sql``;

    /* 페이지 데이터 */
    const dataResult: any = await db.execute(sql`
      SELECT
        m.id,
        m.name,
        m.email,
        m.phone,
        m.donor_channels,
        m.next_billing_date,
        m.donor_evaluated_at,
        m.hyosung_contract_status
      FROM members m
      WHERE m.donor_type = 'regular'
        ${channelFilter}
        ${qFilter}
      ORDER BY m.donor_evaluated_at DESC NULLS LAST, m.id DESC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `);
    memberRows = Array.isArray(dataResult) ? dataResult : (dataResult as any).rows || [];

    /* total */
    const totalResult: any = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM members m
      WHERE m.donor_type = 'regular'
        ${channelFilter}
        ${qFilter}
    `);
    const totalRow = (Array.isArray(totalResult) ? totalResult[0] : (totalResult as any).rows?.[0]) || {};
    total = Number(totalRow.total) || 0;
  } catch (err) {
    return jsonError("select_members", err);
  }

  /* 빈 결과 short-circuit */
  if (memberRows.length === 0) {
    let kpi = { regularTotal: 0, tossCount: 0, hyosungCount: 0, bothCount: 0, monthlyAmountSum: 0 };
    try {
      kpi = await fetchRegularKpi();
    } catch (err) {
      console.warn("[admin-donor-regular-list] KPI 조회 실패", err);
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

  /* 4. 보조 조회 (ID 배열로 separate query + Map 매칭 — 다중 leftJoin 금지) */
  const memberIds = memberRows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0);

  /* 4-1. 토스 빌링키 active (amount + nextChargeAt) */
  const tossMap = new Map<number, { amount: number; nextChargeAt: Date | null }>();
  try {
    const rs: any = await db.execute(sql`
      SELECT member_id, amount, next_charge_at
      FROM billing_keys
      WHERE is_active = true
        AND member_id = ANY(${sql.raw(`ARRAY[${memberIds.join(",") || "0"}]::int[]`)})
    `);
    const rows = Array.isArray(rs) ? rs : (rs as any).rows || [];
    for (const r of rows) {
      const mid = Number(r.member_id);
      if (!mid) continue;
      const prev = tossMap.get(mid);
      const amount = Number(r.amount) || 0;
      const nextAt = r.next_charge_at ? new Date(r.next_charge_at) : null;
      tossMap.set(mid, {
        amount: (prev?.amount || 0) + amount,
        nextChargeAt:
          prev?.nextChargeAt && nextAt
            ? prev.nextChargeAt < nextAt
              ? prev.nextChargeAt
              : nextAt
            : prev?.nextChargeAt || nextAt,
      });
    }
  } catch (err) {
    console.warn("[admin-donor-regular-list] billing_keys 조회 실패 — 0 fallback", err);
  }

  /* 4-2. 효성 contracts active (product_amount) */
  const hyosungAmountMap = new Map<number, number>();
  try {
    const rs: any = await db.execute(sql`
      SELECT m.id AS member_id, COALESCE(SUM(hc.product_amount), 0)::int AS amount
      FROM members m
      LEFT JOIN hyosung_contracts hc
        ON hc.member_no = m.hyosung_member_no
       AND LOWER(COALESCE(hc.contract_status,'')) = 'active'
      WHERE m.id = ANY(${sql.raw(`ARRAY[${memberIds.join(",") || "0"}]::int[]`)})
        AND LOWER(COALESCE(m.hyosung_contract_status,'')) = 'active'
      GROUP BY m.id
    `);
    const rows = Array.isArray(rs) ? rs : (rs as any).rows || [];
    for (const r of rows) {
      const mid = Number(r.member_id);
      const amt = Number(r.amount) || 0;
      if (mid && amt > 0) hyosungAmountMap.set(mid, amt);
    }
  } catch (err) {
    console.warn("[admin-donor-regular-list] hyosung_contracts 조회 실패 — 0 fallback", err);
  }

  /* 4-3. donations regular completed (count + sum) */
  const donationStatsMap = new Map<number, { count: number; sum: number }>();
  try {
    const rs: any = await db.execute(sql`
      SELECT
        member_id,
        COUNT(*)::int AS cnt,
        COALESCE(SUM(amount), 0)::bigint AS sum
      FROM donations
      WHERE member_id = ANY(${sql.raw(`ARRAY[${memberIds.join(",") || "0"}]::int[]`)})
        AND type = 'regular'
        AND status = 'completed'
      GROUP BY member_id
    `);
    const rows = Array.isArray(rs) ? rs : (rs as any).rows || [];
    for (const r of rows) {
      const mid = Number(r.member_id);
      if (!mid) continue;
      donationStatsMap.set(mid, {
        count: Number(r.cnt) || 0,
        sum: Number(r.sum) || 0,
      });
    }
  } catch (err) {
    console.warn("[admin-donor-regular-list] donations 통계 조회 실패 — 0 fallback", err);
  }

  /* 5. 응답 매핑 */
  let data: AdminDonorRegular[] = [];
  try {
    data = memberRows.map((r): AdminDonorRegular => {
      const id = Number(r.id);
      const channels = normalizeChannels(r.donor_channels);
      const tossInfo = tossMap.get(id);
      const hyosungAmount = hyosungAmountMap.get(id) || 0;
      const regularAmount = (tossInfo?.amount || 0) + hyosungAmount;
      const stats = donationStatsMap.get(id) || { count: 0, sum: 0 };

      const memberNextBilling = r.next_billing_date ? new Date(r.next_billing_date) : null;
      const tossNextCharge = tossInfo?.nextChargeAt || null;
      const nextBillingDate = memberNextBilling || tossNextCharge;

      return {
        id,
        name: r.name || "",
        email: r.email || null,
        phone: r.phone || null,
        channels,
        regularAmount: regularAmount > 0 ? regularAmount : null,
        nextBillingDate: nextBillingDate ? nextBillingDate.toISOString() : null,
        cumulativeMonths: stats.count,
        cumulativeAmount: stats.sum,
        donorEvaluatedAt: r.donor_evaluated_at
          ? new Date(r.donor_evaluated_at).toISOString()
          : new Date(0).toISOString(),
      };
    });
  } catch (err) {
    return jsonError("map", err);
  }

  /* 6. KPI (전체 — 필터 무관) */
  let kpi = { regularTotal: 0, tossCount: 0, hyosungCount: 0, bothCount: 0, monthlyAmountSum: 0 };
  try {
    kpi = await fetchRegularKpi();
  } catch (err) {
    console.warn("[admin-donor-regular-list] KPI 조회 실패 — 0 fallback", err);
  }

  /* 7. 응답 — ok 헬퍼 wrap (Phase 1과 동일 패턴, res.data?.data?.data) */
  return new Response(
    JSON.stringify({
      ok: true,
      message: null,
      data: { ok: true, data, page, pageSize, total, kpi },
    }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};

/* =========================================================
   헬퍼
   ========================================================= */

function normalizeChannels(raw: any): DonorChannel[] {
  if (!raw) return [];
  let arr: any[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      arr = Array.isArray(parsed) ? parsed : [];
    } catch {
      arr = [];
    }
  }
  const out: DonorChannel[] = [];
  for (const v of arr) {
    if (v === "toss" || v === "hyosung") out.push(v);
  }
  return out;
}

async function fetchRegularKpi() {
  const rs: any = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE m.donor_type = 'regular')::int AS regular_total,
      COUNT(*) FILTER (WHERE m.donor_type = 'regular' AND m.donor_channels @> '["toss"]'::jsonb)::int AS toss_count,
      COUNT(*) FILTER (WHERE m.donor_type = 'regular' AND m.donor_channels @> '["hyosung"]'::jsonb)::int AS hyosung_count,
      COUNT(*) FILTER (WHERE m.donor_type = 'regular'
        AND m.donor_channels @> '["toss"]'::jsonb
        AND m.donor_channels @> '["hyosung"]'::jsonb)::int AS both_count
    FROM members m
  `);
  const row = (Array.isArray(rs) ? rs[0] : (rs as any).rows?.[0]) || {};

  /* 월 합계: 토스 active billing_keys.amount + 효성 active contracts.product_amount */
  const sumRs: any = await db.execute(sql`
    SELECT (
      COALESCE((
        SELECT SUM(bk.amount) FROM billing_keys bk
        INNER JOIN members m ON m.id = bk.member_id
        WHERE bk.is_active = true AND m.donor_type = 'regular'
      ), 0)
      +
      COALESCE((
        SELECT SUM(hc.product_amount) FROM hyosung_contracts hc
        INNER JOIN members m ON m.hyosung_member_no = hc.member_no
        WHERE LOWER(COALESCE(hc.contract_status,'')) = 'active'
          AND LOWER(COALESCE(m.hyosung_contract_status,'')) = 'active'
          AND m.donor_type = 'regular'
      ), 0)
    )::bigint AS monthly_sum
  `);
  const sumRow = (Array.isArray(sumRs) ? sumRs[0] : (sumRs as any).rows?.[0]) || {};

  return {
    regularTotal: Number(row.regular_total) || 0,
    tossCount: Number(row.toss_count) || 0,
    hyosungCount: Number(row.hyosung_count) || 0,
    bothCount: Number(row.both_count) || 0,
    monthlyAmountSum: Number(sumRow.monthly_sum) || 0,
  };
}

export const config = { path: "/api/admin/donor-regular-list" };
