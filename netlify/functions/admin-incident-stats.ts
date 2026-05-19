import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { incidentReports, harassmentReports, legalConsultations } from "../../db/schema";
import { sql, and, gte, lt } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ok, serverError } from "../../lib/response";

export const config = { path: "/api/admin-incident-stats" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const auth: any = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  // period: "30d" | "90d" | "180d" | "365d" | "all"
  const period = url.searchParams.get("period") || "30d";

  let fromDate: Date | null = null;
  const now = new Date();
  if (period !== "all") {
    const days = parseInt(period) || 30;
    fromDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  // ── 사건 신고(incidentReports) 집계 ─────────────────────────
  let incidentStats: any = {
    total: 0,
    byStatus: {},
    bySeverity: {},
    recentList: [],
    trend: [],
  };
  try {
    const whereClause = fromDate
      ? sql`created_at >= ${fromDate.toISOString()}`
      : sql`1=1`;

    const totalRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM incident_reports
      WHERE ${whereClause}
    `);
    const total = Number((totalRes.rows ?? totalRes)[0]?.total ?? 0);

    const byStatusRes: any = await db.execute(sql`
      SELECT status, COUNT(*)::int AS cnt
      FROM incident_reports
      WHERE ${whereClause}
      GROUP BY status
    `);
    const byStatus: Record<string, number> = {};
    for (const row of (byStatusRes.rows ?? byStatusRes)) {
      byStatus[row.status] = Number(row.cnt);
    }

    const bySeverityRes: any = await db.execute(sql`
      SELECT COALESCE(ai_severity, 'unknown') AS severity, COUNT(*)::int AS cnt
      FROM incident_reports
      WHERE ${whereClause}
      GROUP BY COALESCE(ai_severity, 'unknown')
    `);
    const bySeverity: Record<string, number> = {};
    for (const row of (bySeverityRes.rows ?? bySeverityRes)) {
      bySeverity[row.severity] = Number(row.cnt);
    }

    const trendRes: any = await db.execute(sql`
      SELECT TO_CHAR(created_at, 'YYYY-MM') AS ym, COUNT(*)::int AS cnt
      FROM incident_reports
      WHERE ${whereClause}
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY ym
    `);
    const trend = (trendRes.rows ?? trendRes).map((r: any) => ({
      ym: r.ym,
      count: Number(r.cnt),
    }));

    const recentRes: any = await db.execute(sql`
      SELECT id, report_no AS "reportNo", title, status, ai_severity AS "aiSeverity",
             created_at AS "createdAt"
      FROM incident_reports
      ${fromDate ? sql`WHERE created_at >= ${fromDate.toISOString()}` : sql``}
      ORDER BY created_at DESC
      LIMIT 10
    `);
    const recentList = (recentRes.rows ?? recentRes).map((r: any) => ({
      id: r.id,
      reportNo: r.reportNo,
      title: r.title,
      status: r.status,
      aiSeverity: r.aiSeverity,
      createdAt: r.createdAt,
    }));

    incidentStats = { total, byStatus, bySeverity, trend, recentList };
  } catch (err: any) {
    console.warn("[admin-incident-stats] incidentReports 집계 실패:", err?.message);
  }

  // ── 괴롭힘 신고(harassmentReports) 집계 ────────────────────
  let harassmentStats: any = {
    total: 0,
    byStatus: {},
    byCategory: {},
    bySeverity: {},
    recentList: [],
    trend: [],
  };
  try {
    const whereClause = fromDate
      ? sql`created_at >= ${fromDate.toISOString()}`
      : sql`1=1`;

    const totalRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM harassment_reports
      WHERE ${whereClause}
    `);
    const total = Number((totalRes.rows ?? totalRes)[0]?.total ?? 0);

    const byStatusRes: any = await db.execute(sql`
      SELECT status, COUNT(*)::int AS cnt
      FROM harassment_reports
      WHERE ${whereClause}
      GROUP BY status
    `);
    const byStatus: Record<string, number> = {};
    for (const row of (byStatusRes.rows ?? byStatusRes)) {
      byStatus[row.status] = Number(row.cnt);
    }

    const byCategoryRes: any = await db.execute(sql`
      SELECT category, COUNT(*)::int AS cnt
      FROM harassment_reports
      WHERE ${whereClause}
      GROUP BY category
    `);
    const byCategory: Record<string, number> = {};
    for (const row of (byCategoryRes.rows ?? byCategoryRes)) {
      byCategory[row.category] = Number(row.cnt);
    }

    const bySeverityRes: any = await db.execute(sql`
      SELECT COALESCE(ai_severity, 'unknown') AS severity, COUNT(*)::int AS cnt
      FROM harassment_reports
      WHERE ${whereClause}
      GROUP BY COALESCE(ai_severity, 'unknown')
    `);
    const bySeverity: Record<string, number> = {};
    for (const row of (bySeverityRes.rows ?? bySeverityRes)) {
      bySeverity[row.severity] = Number(row.cnt);
    }

    const trendRes: any = await db.execute(sql`
      SELECT TO_CHAR(created_at, 'YYYY-MM') AS ym, COUNT(*)::int AS cnt
      FROM harassment_reports
      WHERE ${whereClause}
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY ym
    `);
    const trend = (trendRes.rows ?? trendRes).map((r: any) => ({
      ym: r.ym,
      count: Number(r.cnt),
    }));

    const recentRes: any = await db.execute(sql`
      SELECT id, report_no AS "reportNo", title, category, status,
             ai_severity AS "aiSeverity", created_at AS "createdAt"
      FROM harassment_reports
      ${fromDate ? sql`WHERE created_at >= ${fromDate.toISOString()}` : sql``}
      ORDER BY created_at DESC
      LIMIT 10
    `);
    const recentList = (recentRes.rows ?? recentRes).map((r: any) => ({
      id: r.id,
      reportNo: r.reportNo,
      title: r.title,
      category: r.category,
      status: r.status,
      aiSeverity: r.aiSeverity,
      createdAt: r.createdAt,
    }));

    harassmentStats = { total, byStatus, byCategory, bySeverity, trend, recentList };
  } catch (err: any) {
    console.warn("[admin-incident-stats] harassmentReports 집계 실패:", err?.message);
  }

  // ── 법률 상담(legalConsultations) 집계 ─────────────────────
  let legalStats: any = {
    total: 0,
    byStatus: {},
    byCategory: {},
    byUrgency: {},
    recentList: [],
    trend: [],
  };
  try {
    const whereClause = fromDate
      ? sql`created_at >= ${fromDate.toISOString()}`
      : sql`1=1`;

    const totalRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM legal_consultations
      WHERE ${whereClause}
    `);
    const total = Number((totalRes.rows ?? totalRes)[0]?.total ?? 0);

    const byStatusRes: any = await db.execute(sql`
      SELECT status, COUNT(*)::int AS cnt
      FROM legal_consultations
      WHERE ${whereClause}
      GROUP BY status
    `);
    const byStatus: Record<string, number> = {};
    for (const row of (byStatusRes.rows ?? byStatusRes)) {
      byStatus[row.status] = Number(row.cnt);
    }

    const byCategoryRes: any = await db.execute(sql`
      SELECT category, COUNT(*)::int AS cnt
      FROM legal_consultations
      WHERE ${whereClause}
      GROUP BY category
    `);
    const byCategory: Record<string, number> = {};
    for (const row of (byCategoryRes.rows ?? byCategoryRes)) {
      byCategory[row.category] = Number(row.cnt);
    }

    // legalConsultations: aiUrgency 사용 (aiSeverity 아님)
    const byUrgencyRes: any = await db.execute(sql`
      SELECT COALESCE(ai_urgency, 'unknown') AS urgency, COUNT(*)::int AS cnt
      FROM legal_consultations
      WHERE ${whereClause}
      GROUP BY COALESCE(ai_urgency, 'unknown')
    `);
    const byUrgency: Record<string, number> = {};
    for (const row of (byUrgencyRes.rows ?? byUrgencyRes)) {
      byUrgency[row.urgency] = Number(row.cnt);
    }

    const trendRes: any = await db.execute(sql`
      SELECT TO_CHAR(created_at, 'YYYY-MM') AS ym, COUNT(*)::int AS cnt
      FROM legal_consultations
      WHERE ${whereClause}
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY ym
    `);
    const trend = (trendRes.rows ?? trendRes).map((r: any) => ({
      ym: r.ym,
      count: Number(r.cnt),
    }));

    const recentRes: any = await db.execute(sql`
      SELECT id, consultation_no AS "consultationNo", title, category, status,
             ai_urgency AS "aiUrgency", created_at AS "createdAt"
      FROM legal_consultations
      ${fromDate ? sql`WHERE created_at >= ${fromDate.toISOString()}` : sql``}
      ORDER BY created_at DESC
      LIMIT 10
    `);
    const recentList = (recentRes.rows ?? recentRes).map((r: any) => ({
      id: r.id,
      consultationNo: r.consultationNo,
      title: r.title,
      category: r.category,
      status: r.status,
      aiUrgency: r.aiUrgency,
      createdAt: r.createdAt,
    }));

    legalStats = { total, byStatus, byCategory, byUrgency, trend, recentList };
  } catch (err: any) {
    console.warn("[admin-incident-stats] legalConsultations 집계 실패:", err?.message);
  }

  // A 프론트가 기대하는 구조로 변환
  function toArray(obj: Record<string, number>, keyName: string) {
    return Object.entries(obj).map(([k, v]) => ({ [keyName]: k, count: v }));
  }
  function toMonthlyTrend(trend: { ym: string; count: number }[]) {
    return trend.map(r => ({ month: r.ym, count: r.count }));
  }

  const totalCount =
    (incidentStats.total || 0) +
    (harassmentStats.total || 0) +
    (legalStats.total || 0);

  return ok({
    period,
    summary: {
      total:      { count: totalCount },
      incidents:  { count: incidentStats.total || 0 },
      harassment: { count: harassmentStats.total || 0 },
      legal:      { count: legalStats.total || 0 },
    },
    incidents: {
      byStatus:     toArray(incidentStats.byStatus || {}, "status"),
      bySeverity:   toArray(incidentStats.bySeverity || {}, "level"),
      monthlyTrend: toMonthlyTrend(incidentStats.trend || []),
    },
    harassment: {
      byStatus:     toArray(harassmentStats.byStatus || {}, "status"),
      bySeverity:   toArray(harassmentStats.bySeverity || {}, "level"),
      monthlyTrend: toMonthlyTrend(harassmentStats.trend || []),
    },
    legal: {
      byStatus:     toArray(legalStats.byStatus || {}, "status"),
      byUrgency:    toArray(legalStats.byUrgency || {}, "level"),
      monthlyTrend: toMonthlyTrend(legalStats.trend || []),
    },
  });
}
