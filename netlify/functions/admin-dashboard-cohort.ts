import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "코호트 조회 실패",
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
  const months = Math.min(24, Math.max(1, Number(url.searchParams.get("months") || "6")));

  /* 가입월 기준 코호트 분석 */
  let cohorts: any[];
  try {
    /*
      각 가입 코호트(월)별:
      - newMembers: 해당 월 신규 가입자
      - firstDonationRate: 기간 내 첫 후원 전환율
      - regularConvertRate: 정기 후원 전환율
      - churnRate: 이탈(탈퇴) 비율
      - avgDaysToFirstDonation: 첫 후원까지 평균 일수
    */
    const cohortRes = await db.execute(sql`
      WITH cohort_base AS (
        SELECT
          id AS member_id,
          DATE_TRUNC('month', created_at) AS cohort_month
        FROM members
        WHERE created_at >= NOW() - make_interval(months => ${months})
          AND type NOT IN ('admin', 'operator')
      ),
      first_donations AS (
        SELECT
          d.member_id,
          MIN(d.created_at) AS first_donation_at,
          BOOL_OR(d.type = 'regular') AS has_regular
        FROM donations d
        WHERE d.status = 'completed'
          AND d.member_id IS NOT NULL
        GROUP BY d.member_id
      ),
      churn_data AS (
        SELECT id AS member_id
        FROM members
        WHERE status = 'withdrawn'
      )
      SELECT
        TO_CHAR(c.cohort_month, 'YYYY-MM')          AS month,
        COUNT(c.member_id)::int                      AS new_members,
        COUNT(fd.member_id)::int                     AS donated_cnt,
        COUNT(fd.member_id) FILTER (WHERE fd.has_regular)::int AS regular_cnt,
        COUNT(ch.member_id)::int                     AS churned_cnt,
        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (fd.first_donation_at - m.created_at)) / 86400.0
          ) FILTER (WHERE fd.first_donation_at IS NOT NULL)
        )::int                                       AS avg_days_to_first_donation
      FROM cohort_base c
      JOIN members m ON m.id = c.member_id
      LEFT JOIN first_donations fd ON fd.member_id = c.member_id
      LEFT JOIN churn_data ch ON ch.member_id = c.member_id
      GROUP BY c.cohort_month
      ORDER BY c.cohort_month
    `);

    cohorts = rows(cohortRes).map((r: any) => {
      const newMembers = Number(r.new_members ?? 0);
      const donatedCnt = Number(r.donated_cnt ?? 0);
      const regularCnt = Number(r.regular_cnt ?? 0);
      const churnedCnt = Number(r.churned_cnt ?? 0);
      return {
        month: r.month,
        newMembers,
        firstDonationRate: newMembers > 0 ? Math.round((donatedCnt / newMembers) * 100) / 100 : 0,
        regularConvertRate: newMembers > 0 ? Math.round((regularCnt / newMembers) * 100) / 100 : 0,
        churnRate: newMembers > 0 ? Math.round((churnedCnt / newMembers) * 100) / 100 : 0,
        avgDaysToFirstDonation: r.avg_days_to_first_donation !== null ? Number(r.avg_days_to_first_donation) : null,
      };
    });
  } catch (err) {
    return jsonError("select_cohort", err);
  }

  return new Response(
    JSON.stringify({ ok: true, cohorts }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};

export const config = { path: "/api/admin-dashboard-cohort" };
