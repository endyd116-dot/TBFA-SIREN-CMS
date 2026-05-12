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

  /* JS에서 기준 날짜 계산 → 문자열로 SQL에 직접 삽입 (interval 파라미터 바인딩 문제 회피) */
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const sinceStr = since.toISOString();

  /* 가입월 기준 코호트 분석 */
  let cohorts: any[];
  try {
    /* step1: 코호트 기간 내 신규 회원 목록 */
    const memberRes = await db.execute(sql`
      SELECT id, DATE_TRUNC('month', created_at) AS cohort_month, created_at, status
      FROM members
      WHERE created_at >= ${sinceStr}::timestamptz
        AND type != 'admin'
      ORDER BY cohort_month
    `);
    const memberRows = rows(memberRes);

    if (memberRows.length === 0) {
      cohorts = [];
    } else {
      const memberIds = memberRows.map((r: any) => r.id);

      /* step2: 해당 회원들의 후원 이력 */
      const donRows: any[] = [];
      try {
        const donRes = await db.execute(sql`
          SELECT member_id, MIN(created_at) AS first_at,
                 BOOL_OR(donation_type = 'regular' OR type = 'regular') AS has_regular
          FROM donations
          WHERE status = 'completed'
            AND member_id IS NOT NULL
          GROUP BY member_id
        `);
        donRows.push(...rows(donRes));
      } catch (_e) { /* donations 테이블 없거나 컬럼명 달라도 계속 */ }

      const donMap = new Map<string, any>();
      for (const d of donRows) donMap.set(String(d.member_id), d);

      /* step3: 월별 집계 */
      const byMonth = new Map<string, { members: any[]; month: string }>();
      for (const m of memberRows) {
        const key = String(m.cohort_month).slice(0, 7).replace('T', ' ').slice(0, 7);
        const monthKey = new Date(m.cohort_month).toISOString().slice(0, 7);
        if (!byMonth.has(monthKey)) byMonth.set(monthKey, { month: monthKey, members: [] });
        byMonth.get(monthKey)!.members.push(m);
      }

      cohorts = Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)).map(({ month, members }) => {
        const newMembers = members.length;
        let donatedCnt = 0, regularCnt = 0, churnedCnt = 0, totalDays = 0, daysCount = 0;
        for (const m of members) {
          const don = donMap.get(String(m.id));
          if (don) {
            donatedCnt++;
            if (don.has_regular) regularCnt++;
            const diff = (new Date(don.first_at).getTime() - new Date(m.created_at).getTime()) / 86400000;
            if (diff >= 0) { totalDays += diff; daysCount++; }
          }
          if (m.status === 'withdrawn') churnedCnt++;
        }
        return {
          month,
          newMembers,
          firstDonationRate: newMembers > 0 ? Math.round((donatedCnt / newMembers) * 100) / 100 : 0,
          regularConvertRate: newMembers > 0 ? Math.round((regularCnt / newMembers) * 100) / 100 : 0,
          churnRate: newMembers > 0 ? Math.round((churnedCnt / newMembers) * 100) / 100 : 0,
          avgDaysToFirstDonation: daysCount > 0 ? Math.round(totalDays / daysCount) : null,
        };
      });
    }
  } catch (err) {
    return jsonError("select_cohort", err);
  }

  return new Response(
    JSON.stringify({ ok: true, cohorts }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};

export const config = { path: "/api/admin-dashboard-cohort" };
