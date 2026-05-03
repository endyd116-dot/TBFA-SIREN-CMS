// netlify/functions/admin-harassment-reports.ts
// ★ M-10: 악성민원 신고 관리자 목록 조회

import type { Context } from "@netlify/functions";
import { eq, and, desc, count, or, like, sql } from "drizzle-orm";
import { db } from "../../db";
import { harassmentReports, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin/harassment-reports" };

const VALID_STATUSES = ["submitted", "ai_analyzed", "reviewing", "responded", "closed", "rejected"];
const VALID_SEVERITIES = ["critical", "high", "medium", "low"];
const VALID_CATEGORIES = ["parent", "student", "admin", "colleague", "other"];

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
    const category = url.searchParams.get("category") || "";
    const onlySiren = url.searchParams.get("onlySiren") === "1";
    const q = String(url.searchParams.get("q") || "").trim().slice(0, 100);

    const conds: any[] = [];
    if (VALID_STATUSES.includes(status)) conds.push(eq(harassmentReports.status, status as any));
    if (VALID_SEVERITIES.includes(severity)) conds.push(eq(harassmentReports.aiSeverity, severity));
    if (VALID_CATEGORIES.includes(category)) conds.push(eq(harassmentReports.category, category as any));
    if (onlySiren) conds.push(eq(harassmentReports.sirenReportRequested, true));
    if (q) {
      conds.push(or(
        like(harassmentReports.title, `%${q}%`),
        like(harassmentReports.reportNo, `%${q}%`),
      ));
    }
    const where = conds.length === 0 ? undefined : (conds.length === 1 ? conds[0] : and(...conds));

    const [{ total }]: any = await db.select({ total: count() }).from(harassmentReports).where(where as any);

    const list = await db.select({
      id: harassmentReports.id,
      reportNo: harassmentReports.reportNo,
      title: harassmentReports.title,
      category: harassmentReports.category,
      isAnonymous: harassmentReports.isAnonymous,
      reporterName: harassmentReports.reporterName,
      memberId: harassmentReports.memberId,
      aiSeverity: harassmentReports.aiSeverity,
      aiSummary: harassmentReports.aiSummary,
      aiLegalReviewNeeded: harassmentReports.aiLegalReviewNeeded,
      aiPsychSupportNeeded: harassmentReports.aiPsychSupportNeeded,
      sirenReportRequested: harassmentReports.sirenReportRequested,
      status: harassmentReports.status,
      adminResponse: harassmentReports.adminResponse,
      respondedAt: harassmentReports.respondedAt,
      createdAt: harassmentReports.createdAt,
      memberName: members.name,
    })
      .from(harassmentReports)
      .leftJoin(members, eq(harassmentReports.memberId, members.id))
      .where(where as any)
      .orderBy(desc(harassmentReports.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const stats = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'submitted')::int  AS "submittedCount",
        COUNT(*) FILTER (WHERE status = 'ai_analyzed')::int AS "aiAnalyzedCount",
        COUNT(*) FILTER (WHERE status = 'reviewing')::int   AS "reviewingCount",
        COUNT(*) FILTER (WHERE status = 'responded')::int   AS "respondedCount",
        COUNT(*) FILTER (WHERE siren_report_requested = TRUE)::int AS "sirenRequestedCount",
        COUNT(*) FILTER (WHERE ai_severity IN ('critical','high'))::int AS "highSeverityCount"
      FROM harassment_reports
    `);
    const s: any = stats[0] || {};

    return ok({
      list,
      pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
      stats: {
        submitted: s.submittedCount || 0,
        aiAnalyzed: s.aiAnalyzedCount || 0,
        reviewing: s.reviewingCount || 0,
        responded: s.respondedCount || 0,
        sirenRequested: s.sirenRequestedCount || 0,
        highSeverity: s.highSeverityCount || 0,
      },
    });
  } catch (e: any) {
    console.error("[admin-harassment-reports]", e);
    return serverError("조회 실패", e);
  }
};