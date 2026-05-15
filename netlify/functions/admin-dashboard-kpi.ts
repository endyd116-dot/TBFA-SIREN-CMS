import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "KPI 조회 실패",
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

const PERIOD_MAP: Record<string, number> = {
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "365d": 365,
};

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
  const periodParam = url.searchParams.get("period") || "30d";
  const days = PERIOD_MAP[periodParam] ?? 30;
  /* ★ 2026-05-16: 싸이렌 어드민 대시보드는 SIREN 웹 가입자만 집계. 효성·수기·
     이벤트 등으로 확보된 회원은 통합 CMS에서 보므로 ?webonly=1 옵션으로 필터.
     필터 조건: signup_sources.code='siren' (사이렌 웹 가입). */
  const webOnly = url.searchParams.get("webonly") === "1";

  /* ── 1. 후원 KPI ── */
  let donation: any;
  try {
    const donationRes = await db.execute(sql`
      SELECT
        COALESCE(SUM(amount), 0)::bigint               AS total_amount,
        COUNT(*)::int                                   AS total_count,
        COUNT(DISTINCT member_id)
          FILTER (WHERE created_at >= NOW() - (${days} || ' days')::interval
                    AND created_at < NOW() - (${days} * 2 || ' days')::interval
                  ) -- 직전 기간은 신규 기준 비교용이라 아래에서 별도 계산
                                                         AS prev_donors
      FROM donations
      WHERE status = 'completed'
        AND created_at >= NOW() - (${days} || ' days')::interval
    `);
    const dr = rows(donationRes)[0] || {};

    /* 신규 후원자: 기간 내 첫 후원 */
    const newDonorRes = await db.execute(sql`
      SELECT COUNT(DISTINCT d.member_id)::int AS cnt
      FROM donations d
      WHERE d.status = 'completed'
        AND d.created_at >= NOW() - (${days} || ' days')::interval
        AND d.member_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM donations d2
          WHERE d2.member_id = d.member_id
            AND d2.status = 'completed'
            AND d2.created_at < NOW() - (${days} || ' days')::interval
        )
    `);
    const newDonors = Number(rows(newDonorRes)[0]?.cnt ?? 0);

    /* 정기후원 유지율: 직전 기간 정기 후원자 중 이번 기간에도 납부한 비율 */
    const retentionRes = await db.execute(sql`
      WITH prev_regular AS (
        SELECT DISTINCT member_id
        FROM donations
        WHERE status = 'completed'
          AND type = 'regular'
          AND created_at >= NOW() - (${days * 2} || ' days')::interval
          AND created_at < NOW() - (${days} || ' days')::interval
          AND member_id IS NOT NULL
      ),
      curr_regular AS (
        SELECT DISTINCT member_id
        FROM donations
        WHERE status = 'completed'
          AND type = 'regular'
          AND created_at >= NOW() - (${days} || ' days')::interval
          AND member_id IS NOT NULL
      )
      SELECT
        COUNT(p.member_id)::int AS prev_cnt,
        COUNT(c.member_id)::int AS retained_cnt
      FROM prev_regular p
      LEFT JOIN curr_regular c ON c.member_id = p.member_id
    `);
    const rr = rows(retentionRes)[0] || {};
    const prevCnt = Number(rr.prev_cnt ?? 0);
    const retainedCnt = Number(rr.retained_cnt ?? 0);
    const regularRetentionRate = prevCnt > 0 ? Math.round((retainedCnt / prevCnt) * 100) / 100 : null;

    /* 월별 트렌드 (최대 12개월) */
    const trendMonths = Math.min(Math.ceil(days / 30), 12);
    const trendRes = await db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COALESCE(SUM(amount), 0)::bigint                     AS amount,
        COUNT(*)::int                                        AS count
      FROM donations
      WHERE status = 'completed'
        AND created_at >= NOW() - (${trendMonths} || ' months')::interval
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at)
    `);
    const monthlyTrend = rows(trendRes).map((r: any) => ({
      month: r.month,
      amount: Number(r.amount),
      count: Number(r.count),
    }));

    donation = {
      totalAmount: Number(dr.total_amount ?? 0),
      totalCount: Number(dr.total_count ?? 0),
      newDonors,
      regularRetentionRate,
      monthlyTrend,
    };
  } catch (err) {
    return jsonError("select_donation", err);
  }

  /* ── 2. 회원 KPI ── */
  let member: any;
  try {
    /* ★ 2026-05-16: webonly=1 시 가입경로 'siren'(웹) 회원만 집계. 효성·수기·
       이벤트 등은 제외 — 싸이렌 어드민 대시보드는 SIREN 플랫폼 가입자만 본다. */
    const webFilter = webOnly
      ? sql`AND m.signup_source_id = (SELECT id FROM signup_sources WHERE code = 'siren' LIMIT 1)`
      : sql``;

    const memberRes = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE m.created_at >= NOW() - (${days} || ' days')::interval)::int AS new_count,
        COUNT(*) FILTER (WHERE m.status = 'active')::int                                    AS active_count,
        COUNT(*) FILTER (
          WHERE m.status = 'withdrawn'
            AND m.withdrawn_at >= NOW() - (${days} || ' days')::interval
        )::int AS withdrawn_count
      FROM members m
      WHERE 1=1 ${webFilter}
    `);
    const mr = rows(memberRes)[0] || {};

    const trendMonths = Math.min(Math.ceil(days / 30), 12);
    const memberTrendRes = await db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', m.created_at), 'YYYY-MM') AS month,
        COUNT(*)::int                                           AS new_count,
        COUNT(*) FILTER (
          WHERE m.status = 'withdrawn'
            AND m.withdrawn_at >= DATE_TRUNC('month', m.created_at)
            AND m.withdrawn_at < DATE_TRUNC('month', m.created_at) + INTERVAL '1 month'
        )::int AS withdrawn_count
      FROM members m
      WHERE m.created_at >= NOW() - (${trendMonths} || ' months')::interval ${webFilter}
      GROUP BY DATE_TRUNC('month', m.created_at)
      ORDER BY DATE_TRUNC('month', m.created_at)
    `);
    const monthlyTrend = rows(memberTrendRes).map((r: any) => ({
      month: r.month,
      newCount: Number(r.new_count),
      withdrawnCount: Number(r.withdrawn_count),
    }));

    /* ★ 2026-05-16: 회원 유형별 분포 (도넛 차트용). webonly 필터 동일 적용. */
    const byTypeRes = await db.execute(sql`
      SELECT type, COUNT(*)::int AS cnt
      FROM members m
      WHERE m.status = 'active' ${webFilter}
      GROUP BY type
    `);
    const byType: Record<string, number> = {};
    for (const r of rows(byTypeRes)) {
      byType[String(r.type)] = Number(r.cnt ?? 0);
    }

    member = {
      newCount: Number(mr.new_count ?? 0),
      activeCount: Number(mr.active_count ?? 0),
      withdrawnCount: Number(mr.withdrawn_count ?? 0),
      monthlyTrend,
      byType,
    };
  } catch (err) {
    return jsonError("select_member", err);
  }

  /* ── 3. SIREN 신고 KPI ── */
  let siren: any;
  try {
    // status 컬럼은 테이블별로 별개 enum 타입(incident_report_status / harassment_report_status / 등)이라
    // UNION ALL 시 PostgreSQL 자동 변환 실패 → 모두 text로 캐스팅
    const sirenRes = await db.execute(sql`
      SELECT type, COUNT(*)::int AS cnt, COUNT(*) FILTER (WHERE status = 'resolved' OR status = 'closed')::int AS resolved
      FROM (
        SELECT 'incident' AS type, status::text AS status, created_at FROM incident_reports
          WHERE created_at >= NOW() - (${days} || ' days')::interval
        UNION ALL
        SELECT 'harassment' AS type, status::text AS status, created_at FROM harassment_reports
          WHERE created_at >= NOW() - (${days} || ' days')::interval
        UNION ALL
        SELECT 'legal' AS type, status::text AS status, created_at FROM legal_consultations
          WHERE created_at >= NOW() - (${days} || ' days')::interval
      ) t
      GROUP BY type
    `);
    const sirenRows = rows(sirenRes);
    let totalNew = 0;
    let totalResolved = 0;
    const byType: { type: string; count: number }[] = [];
    for (const r of sirenRows) {
      totalNew += Number(r.cnt ?? 0);
      totalResolved += Number(r.resolved ?? 0);
      byType.push({ type: String(r.type), count: Number(r.cnt ?? 0) });
    }
    const resolvedRate = totalNew > 0 ? Math.round((totalResolved / totalNew) * 100) / 100 : 0;

    /* ★ 2026-05-16: 최근 12주 신고 추이 (라인 차트용) — 사건·악성·법률 합계 주별 카운트 */
    const weeklyRes = await db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('week', created_at), 'MM-DD') AS week,
        COUNT(*)::int AS cnt
      FROM (
        SELECT created_at FROM incident_reports   WHERE created_at >= NOW() - INTERVAL '12 weeks'
        UNION ALL
        SELECT created_at FROM harassment_reports WHERE created_at >= NOW() - INTERVAL '12 weeks'
        UNION ALL
        SELECT created_at FROM legal_consultations WHERE created_at >= NOW() - INTERVAL '12 weeks'
      ) t
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY DATE_TRUNC('week', created_at)
    `);
    const weeklyTrend = rows(weeklyRes).map((r: any) => ({
      week: String(r.week),
      count: Number(r.cnt ?? 0),
    }));

    siren = { totalNew, resolvedRate, byType, weeklyTrend };
  } catch (err) {
    return jsonError("select_siren", err);
  }

  /* ── 4. 발송 KPI ── */
  let send: any;
  try {
    const sendJobRes = await db.execute(sql`
      SELECT
        COUNT(*)::int                                                          AS total_jobs,
        COUNT(*) FILTER (WHERE status = 'completed')::int                     AS success_jobs
      FROM communication_send_jobs
      WHERE created_at >= NOW() - (${days} || ' days')::interval
    `);
    const sj = rows(sendJobRes)[0] || {};
    const totalJobs = Number(sj.total_jobs ?? 0);
    const successJobs = Number(sj.success_jobs ?? 0);
    const successRate = totalJobs > 0 ? Math.round((successJobs / totalJobs) * 100) / 100 : 0;

    /* openRate: 발송된 수신자 중 열람한 비율 */
    const openRes = await db.execute(sql`
      SELECT
        COUNT(*)::int                                          AS total_sent,
        COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int    AS opened_cnt
      FROM communication_send_recipients
      WHERE created_at >= NOW() - (${days} || ' days')::interval
        AND status = 'sent'
    `);
    const op = rows(openRes)[0] || {};
    const totalSent = Number(op.total_sent ?? 0);
    const openedCnt = Number(op.opened_cnt ?? 0);
    const openRate = totalSent > 0 ? Math.round((openedCnt / totalSent) * 100) / 100 : 0;

    send = { totalJobs, successRate, openRate };
  } catch (err) {
    return jsonError("select_send", err);
  }

  return new Response(
    JSON.stringify({ ok: true, period: periodParam, donation, member, siren, send }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};

export const config = { path: "/api/admin-dashboard-kpi" };
