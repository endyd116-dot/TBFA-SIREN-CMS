// admin-report-list-by-status.ts — 단계별 신고 현황 (어드민 대시보드)
// GET /api/admin-report-list-by-status?reportType=all|incident|harassment|legal&status=&page=1
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { incidentReports, harassmentReports, legalConsultations } from "../../db/schema";
import { eq, desc, and } from "drizzle-orm";

export const config = { path: "/api/admin-report-list-by-status" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "신고 현황 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "허용되지 않는 메서드" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const reportType = url.searchParams.get("reportType") || "all";
  const statusFilter = url.searchParams.get("status") || undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = 30;
  const offset = (page - 1) * limit;

  const results: any[] = [];

  // 사건 신고
  if (reportType === "all" || reportType === "incident") {
    let rows: any[] = [];
    try {
      const cond = statusFilter
        ? eq(incidentReports.status, statusFilter as any)
        : undefined;
      rows = await db.select({
        id: incidentReports.id,
        reportNo: incidentReports.reportNo,
        title: incidentReports.title,
        status: incidentReports.status,
        isAnonymous: incidentReports.isAnonymous,
        aiSeverity: incidentReports.aiSeverity,
        createdAt: incidentReports.createdAt,
        updatedAt: incidentReports.updatedAt,
      })
        .from(incidentReports)
        .where(cond)
        .orderBy(desc(incidentReports.createdAt))
        .limit(reportType === "all" ? Math.ceil(limit / 3) : limit)
        .offset(reportType === "all" ? 0 : offset);
    } catch (err) {
      console.warn("[admin-report-list-by-status] incident 조회 실패", err);
    }
    results.push(...rows.map((r) => ({ ...r, reportType: "incident" })));
  }

  // 괴롭힘 신고
  if (reportType === "all" || reportType === "harassment") {
    let rows: any[] = [];
    try {
      const cond = statusFilter
        ? eq(harassmentReports.status, statusFilter as any)
        : undefined;
      rows = await db.select({
        id: harassmentReports.id,
        reportNo: harassmentReports.reportNo,
        title: harassmentReports.title,
        status: harassmentReports.status,
        isAnonymous: harassmentReports.isAnonymous,
        aiSeverity: harassmentReports.aiSeverity,
        createdAt: harassmentReports.createdAt,
        updatedAt: harassmentReports.updatedAt,
      })
        .from(harassmentReports)
        .where(cond)
        .orderBy(desc(harassmentReports.createdAt))
        .limit(reportType === "all" ? Math.ceil(limit / 3) : limit)
        .offset(reportType === "all" ? 0 : offset);
    } catch (err) {
      console.warn("[admin-report-list-by-status] harassment 조회 실패", err);
    }
    results.push(...rows.map((r) => ({ ...r, reportType: "harassment" })));
  }

  // 법률 상담
  if (reportType === "all" || reportType === "legal") {
    let rows: any[] = [];
    try {
      const cond = statusFilter
        ? eq(legalConsultations.status, statusFilter as any)
        : undefined;
      rows = await db.select({
        id: legalConsultations.id,
        reportNo: legalConsultations.consultationNo,
        title: legalConsultations.title,
        status: legalConsultations.status,
        isAnonymous: legalConsultations.isAnonymous,
        aiSeverity: legalConsultations.aiSeverity,
        createdAt: legalConsultations.createdAt,
        updatedAt: legalConsultations.updatedAt,
      })
        .from(legalConsultations)
        .where(cond)
        .orderBy(desc(legalConsultations.createdAt))
        .limit(reportType === "all" ? Math.ceil(limit / 3) : limit)
        .offset(reportType === "all" ? 0 : offset);
    } catch (err) {
      console.warn("[admin-report-list-by-status] legal 조회 실패", err);
    }
    results.push(...rows.map((r) => ({ ...r, reportType: "legal" })));
  }

  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return new Response(JSON.stringify({ ok: true, page, items: results }), {
    headers: { "Content-Type": "application/json" },
  });
};
