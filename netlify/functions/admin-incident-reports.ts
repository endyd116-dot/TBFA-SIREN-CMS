// netlify/functions/admin-incident-reports.ts
// ★ M-10: 사건 제보 관리자 목록 조회
// ★ 2026-05 패치: db.execute() 결과 처리 표준화 (stats.rows || stats)

import type { Context } from "@netlify/functions";
import { eq, and, desc, count, or, like, sql } from "drizzle-orm";
import { db } from "../../db";
import { incidentReports, incidents, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin/incident-reports" };

const VALID_STATUSES = ["submitted", "ai_analyzed", "reviewing", "responded", "closed", "rejected"];
const VALID_SEVERITIES = ["critical", "high", "medium", "low"];

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;

  try {
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));
    const status = url.searchParams.get("status") || "";
    const severity = url.searchParams.get("severity") || "";
    const onlySiren = url.searchParams.get("onlySiren") === "1";
    const q = String(url.searchParams.get("q") || "").trim().slice(0, 100);

    const conds: any[] = [];
    if (VALID_STATUSES.includes(status)) conds.push(eq(incidentReports.status, status as any));
    if (VALID_SEVERITIES.includes(severity)) conds.push(eq(incidentReports.aiSeverity, severity));
    if (onlySiren) conds.push(eq(incidentReports.sirenReportRequested, true));
    if (q) {
      conds.push(or(
        like(incidentReports.title, `%${q}%`),
        like(incidentReports.reportNo, `%${q}%`),
      ));
    }
    const where = conds.length === 0 ? undefined : (conds.length === 1 ? conds[0] : and(...conds));

    /* 총 개수 */
    const totalRow: any = await db
      .select({ total: count() })
      .from(incidentReports)
      .where(where as any);
    const total = Number(totalRow[0]?.total ?? 0);

    /* 목록 */
    const list = await db.select({
      id: incidentReports.id,
      reportNo: incidentReports.reportNo,
      title: incidentReports.title,
      isAnonymous: incidentReports.isAnonymous,
      reporterName: incidentReports.reporterName,
      memberId: incidentReports.memberId,
      aiSeverity: incidentReports.aiSeverity,
      aiSummary: incidentReports.aiSummary,
      sirenReportRequested: incidentReports.sirenReportRequested,
      status: incidentReports.status,
      adminResponse: incidentReports.adminResponse,
      respondedAt: incidentReports.respondedAt,
      respondedBy: incidentReports.respondedBy,
      createdAt: incidentReports.createdAt,
      incidentTitle: incidents.title,
      incidentSlug: incidents.slug,
      memberName: members.name,
    })
      .from(incidentReports)
      .leftJoin(incidents, eq(incidentReports.incidentId, incidents.id))
      .leftJoin(members, eq(incidentReports.memberId, members.id))
      .where(where as any)
      .orderBy(desc(incidentReports.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    /* 통계 — ★ 패치: drizzle.execute 결과 표준 처리 */
    const statsResult: any = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'submitted')::int  AS "submittedCount",
        COUNT(*) FILTER (WHERE status = 'ai_analyzed')::int AS "aiAnalyzedCount",
        COUNT(*) FILTER (WHERE status = 'reviewing')::int   AS "reviewingCount",
        COUNT(*) FILTER (WHERE status = 'responded')::int   AS "respondedCount",
        COUNT(*) FILTER (WHERE siren_report_requested = TRUE)::int AS "sirenRequestedCount",
        COUNT(*) FILTER (WHERE ai_severity IN ('critical','high'))::int AS "highSeverityCount"
      FROM incident_reports
    `);
    /* postgres-js drizzle: result.rows 또는 직접 배열 — 양쪽 모두 안전 처리 */
    const statsRows = Array.isArray(statsResult)
      ? statsResult
      : (statsResult?.rows || []);
    const s: any = statsRows[0] || {};

    return ok({
      list,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      stats: {
        submitted: Number(s.submittedCount || 0),
        aiAnalyzed: Number(s.aiAnalyzedCount || 0),
        reviewing: Number(s.reviewingCount || 0),
        responded: Number(s.respondedCount || 0),
        sirenRequested: Number(s.sirenRequestedCount || 0),
        highSeverity: Number(s.highSeverityCount || 0),
      },
    });
  } catch (e: any) {
    console.error("[admin-incident-reports]", e);
    return serverError("조회 실패", e?.message);
  }
};