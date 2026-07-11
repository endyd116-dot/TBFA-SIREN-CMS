import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "이사회 보고 조회 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

function rows(res: any): any[] {
  return Array.isArray(res) ? res : (res?.rows ?? []);
}

/** 분기 시작/종료 ISO 문자열 반환 */
function quarterRange(year: number, quarter: number): { start: string; end: string; label: string } {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const start = new Date(Date.UTC(year, startMonth - 1, 1)).toISOString();
  const end = new Date(Date.UTC(year, endMonth, 1)).toISOString(); // exclusive
  const label = `${year} Q${quarter}`;
  return { start, end, label };
}

/** 연간 시작/종료 ISO 문자열 반환 */
function annualRange(year: number): { start: string; end: string; label: string } {
  const start = new Date(Date.UTC(year, 0, 1)).toISOString();
  const end = new Date(Date.UTC(year + 1, 0, 1)).toISOString(); // exclusive
  const label = `${year}`;
  return { start, end, label };
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

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "quarterly"; // quarterly | annual
  const now = new Date();
  const year = Number(url.searchParams.get("year") || now.getUTCFullYear());
  const quarter = Math.min(4, Math.max(1, Number(url.searchParams.get("quarter") || Math.ceil((now.getUTCMonth() + 1) / 3))));

  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    return new Response(JSON.stringify({ ok: false, error: "유효하지 않은 연도" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const range = type === "annual" ? annualRange(year) : quarterRange(year, quarter);
  const { start, end, label: period } = range;

  /* ── 1. 후원 집계 ── */
  let donation: any;
  try {
    const donRes = await db.execute(sql`
      SELECT
        COALESCE(SUM(amount), 0)::bigint                                  AS total_amount,
        COALESCE(SUM(amount) FILTER (WHERE type = 'regular'), 0)::bigint  AS regular_amount,
        COALESCE(SUM(amount) FILTER (WHERE type = 'onetime'), 0)::bigint  AS onetime_amount,
        COUNT(DISTINCT member_id)
          FILTER (WHERE member_id IS NOT NULL)::int                        AS new_donors_approx
      FROM donations
      WHERE status = 'completed'
        AND created_at >= ${start}::timestamptz
        AND created_at < ${end}::timestamptz
    `);
    const dr = rows(donRes)[0] || {};

    /* 신규 후원자: 기간 내 첫 후원자 */
    const newDonorRes = await db.execute(sql`
      SELECT COUNT(DISTINCT d.member_id)::int AS cnt
      FROM donations d
      WHERE d.status = 'completed'
        AND d.created_at >= ${start}::timestamptz
        AND d.created_at < ${end}::timestamptz
        AND d.member_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM donations d2
          WHERE d2.member_id = d.member_id
            AND d2.status = 'completed'
            AND d2.created_at < ${start}::timestamptz
        )
    `);
    const newDonors = Number(rows(newDonorRes)[0]?.cnt ?? 0);

    donation = {
      totalAmount: Number(dr.total_amount ?? 0),
      regularAmount: Number(dr.regular_amount ?? 0),
      oneTimeAmount: Number(dr.onetime_amount ?? 0),
      newDonors,
    };
  } catch (err) {
    return jsonError("select_donation", err);
  }

  /* ── 2. 회원 집계 ── */
  let member: any;
  try {
    const memRes = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')::int          AS total_active,
        COUNT(*) FILTER (
          WHERE created_at >= ${start}::timestamptz
            AND created_at < ${end}::timestamptz
        )::int                                                   AS new_count,
        COUNT(*) FILTER (
          WHERE status = 'withdrawn'
            AND withdrawn_at >= ${start}::timestamptz
            AND withdrawn_at < ${end}::timestamptz
        )::int                                                   AS withdrawn_count,
        COUNT(*) FILTER (WHERE type = 'volunteer')::int          AS expert_count
      FROM members
    `);
    const mr = rows(memRes)[0] || {};
    member = {
      totalActive: Number(mr.total_active ?? 0),
      newCount: Number(mr.new_count ?? 0),
      withdrawnCount: Number(mr.withdrawn_count ?? 0),
      expertCount: Number(mr.expert_count ?? 0),
    };
  } catch (err) {
    return jsonError("select_member", err);
  }

  /* ── 3. SIREN 신고 집계 ── */
  let siren: any;
  try {
    /* R41 Q2-036: 신고 3종 enum엔 'resolved' 없음 → 처리완료를 실제 종결 enum값으로 집계.
       (responded/closed/rejected = 처리·종결, 그 외 = 미처리. report-collector의 open=NOT IN('closed','rejected')와 의미 통일) */
    const sirenRes = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total_handled,
        COUNT(*) FILTER (WHERE status IN ('responded', 'closed', 'rejected'))::int AS resolved_count,
        COUNT(*) FILTER (WHERE status NOT IN ('responded', 'closed', 'rejected'))::int AS pending_count
      FROM (
        SELECT status, created_at FROM incident_reports
        UNION ALL
        SELECT status, created_at FROM harassment_reports
        UNION ALL
        SELECT status, created_at FROM legal_consultations
      ) t
      WHERE created_at >= ${start}::timestamptz
        AND created_at < ${end}::timestamptz
    `);
    const sr = rows(sirenRes)[0] || {};
    siren = {
      totalHandled: Number(sr.total_handled ?? 0),
      resolvedCount: Number(sr.resolved_count ?? 0),
      pendingCount: Number(sr.pending_count ?? 0),
    };
  } catch (err) {
    return jsonError("select_siren", err);
  }

  /* ── 4. 수혜자 지원 집계 (support_requests 카테고리별) ── */
  let beneficiary: any;
  try {
    const benRes = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE category = 'counseling')::int AS counseling_count,
        COUNT(*) FILTER (WHERE category = 'scholarship')::int AS scholarship_count,
        COUNT(*) FILTER (WHERE category = 'legal')::int AS legal_count
      FROM support_requests
      WHERE created_at >= ${start}::timestamptz
        AND created_at < ${end}::timestamptz
    `);
    const br = rows(benRes)[0] || {};
    beneficiary = {
      counselingCount: Number(br.counseling_count ?? 0),
      scholarshipCount: Number(br.scholarship_count ?? 0),
      legalCount: Number(br.legal_count ?? 0),
    };
  } catch (err) {
    return jsonError("select_beneficiary", err);
  }

  return new Response(
    JSON.stringify({ ok: true, type, period, donation, member, siren, beneficiary }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};

export const config = { path: "/api/admin-report-board" };
