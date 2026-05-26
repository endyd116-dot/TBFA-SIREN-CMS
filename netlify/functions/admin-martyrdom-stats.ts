/**
 * admin-martyrdom-stats — G5 인정률·성과 통계
 *
 * GET → 인정률·유형별·상태별·월별 추이 집계
 *
 * 응답: {
 *   ok,
 *   totals: { cases, approved, rejected, pending },
 *   recognitionRate,
 *   byCaseType: [{ type, total, approved }],
 *   byStatus:   [{ status, count }],
 *   trend:      [{ month, approved }]
 * }
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-martyrdom-stats" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "GET만 허용" }), { status: 405 });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  /* 총계 */
  let totals = { cases: 0, approved: 0, rejected: 0, pending: 0 };
  try {
    const r: any = await db.execute(sql.raw(`
      SELECT
        COUNT(*)::int AS cases,
        SUM(CASE WHEN outcome = 'approved'  THEN 1 ELSE 0 END)::int AS approved,
        SUM(CASE WHEN outcome = 'rejected'  THEN 1 ELSE 0 END)::int AS rejected,
        SUM(CASE WHEN status  != 'closed'   THEN 1 ELSE 0 END)::int AS pending
      FROM martyrdom_cases
    `));
    const row = (r?.rows ?? r ?? [])[0] || {};
    totals = {
      cases:    Number(row.cases || 0),
      approved: Number(row.approved || 0),
      rejected: Number(row.rejected || 0),
      pending:  Number(row.pending || 0),
    };
  } catch (err: any) {
    return jsonError("select_totals", err);
  }

  const recognitionRate = totals.cases > 0
    ? Math.round((totals.approved / totals.cases) * 100) / 100
    : 0;

  /* 사건 유형별 */
  let byCaseType: Array<{ type: string; total: number; approved: number }> = [];
  try {
    const r: any = await db.execute(sql.raw(`
      SELECT
        COALESCE(extraction_json->>'caseType', 'unknown') AS type,
        COUNT(*)::int AS total,
        SUM(CASE WHEN outcome = 'approved' THEN 1 ELSE 0 END)::int AS approved
      FROM martyrdom_cases
      GROUP BY extraction_json->>'caseType'
      ORDER BY total DESC
    `));
    byCaseType = (r?.rows ?? r ?? []).map((row: any) => ({
      type:     String(row.type || "unknown"),
      total:    Number(row.total || 0),
      approved: Number(row.approved || 0),
    }));
  } catch (err: any) { console.warn("[martyrdom-stats] byCaseType 집계 실패", err?.message); }

  /* 상태별 */
  let byStatus: Array<{ status: string; count: number }> = [];
  try {
    const r: any = await db.execute(sql.raw(`
      SELECT status, COUNT(*)::int AS count
      FROM martyrdom_cases
      GROUP BY status
      ORDER BY count DESC
    `));
    byStatus = (r?.rows ?? r ?? []).map((row: any) => ({
      status: String(row.status || ""),
      count:  Number(row.count || 0),
    }));
  } catch (err: any) { console.warn("[martyrdom-stats] byStatus 집계 실패", err?.message); }

  /* 월별 인정 추이 (최근 12개월) */
  let trend: Array<{ month: string; approved: number }> = [];
  try {
    const r: any = await db.execute(sql.raw(`
      SELECT
        TO_CHAR(updated_at, 'YYYY-MM') AS month,
        COUNT(*)::int AS approved
      FROM martyrdom_cases
      WHERE outcome = 'approved' AND updated_at >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(updated_at, 'YYYY-MM')
      ORDER BY month ASC
    `));
    trend = (r?.rows ?? r ?? []).map((row: any) => ({
      month:    String(row.month || ""),
      approved: Number(row.approved || 0),
    }));
  } catch (err: any) { console.warn("[martyrdom-stats] trend 집계 실패", err?.message); }

  return new Response(JSON.stringify({
    ok: true,
    totals,
    recognitionRate,
    byCaseType,
    byStatus,
    trend,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};
