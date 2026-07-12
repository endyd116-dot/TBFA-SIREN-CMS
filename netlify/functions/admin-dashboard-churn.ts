import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

function jsonError(step: string, err: any) {
  return new Response(
    jsonKST({
      ok: false,
      error: "이탈 위험 조회 실패",
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
    return new Response(jsonKST({ ok: false, error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const level = url.searchParams.get("level") || "all"; // high | medium | all
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || "50")));

  /* ── 요약 통계 (항상 전체 기준) ── */
  let summary: any;
  try {
    const summaryRes = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE churn_risk_score >= 70)::int  AS high_risk,
        COUNT(*) FILTER (WHERE churn_risk_score >= 40 AND churn_risk_score < 70)::int AS medium_risk
      FROM members
      WHERE status = 'active'
        AND churn_risk_score IS NOT NULL
        AND churn_risk_score > 0
    `);
    const s = rows(summaryRes)[0] || {};
    const highRisk = Number(s.high_risk ?? 0);
    const mediumRisk = Number(s.medium_risk ?? 0);
    summary = { highRisk, mediumRisk, total: highRisk + mediumRisk };
  } catch (err) {
    return jsonError("select_summary", err);
  }

  /* ── 회원 목록 ── */
  let memberList: any[];
  try {
    /* level 필터 SQL 조각 */
    const levelFilter =
      level === "high"
        ? sql`AND m.churn_risk_score >= 70`
        : level === "medium"
        ? sql`AND m.churn_risk_score >= 40 AND m.churn_risk_score < 70`
        : sql`AND m.churn_risk_score >= 40`; // all = high + medium

    const memberRes = await db.execute(sql`
      SELECT
        m.id,
        m.name,
        m.churn_risk_score,
        m.churn_risk_level,
        m.last_login_at,
        m.total_donation_amount,
        (
          SELECT MAX(d.created_at)
          FROM donations d
          WHERE d.member_id = m.id AND d.status = 'completed'
        ) AS last_donation_at
      FROM members m
      WHERE m.status = 'active'
        AND m.churn_risk_score IS NOT NULL
        ${levelFilter}
      ORDER BY m.churn_risk_score DESC
      LIMIT ${limit}
    `);

    memberList = rows(memberRes).map((r: any) => ({
      id: Number(r.id),
      name: r.name,
      churnRiskScore: Number(r.churn_risk_score ?? 0),
      churnRiskLevel: r.churn_risk_level,
      lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
      lastDonationAt: r.last_donation_at ? new Date(r.last_donation_at).toISOString() : null,
      totalDonationAmount: Number(r.total_donation_amount ?? 0),
    }));
  } catch (err) {
    return jsonError("select_members", err);
  }

  return new Response(
    jsonKST({ ok: true, summary, members: memberList }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};

export const config = { path: "/api/admin-dashboard-churn" };
