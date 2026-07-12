// admin-report-list-by-status.ts — 단계별 신고 현황 (어드민 대시보드)
// GET /api/admin-report-list-by-status?reportType=all|incident|harassment|legal&status=&page=1
import { jsonKST } from "../../lib/kst";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { incidentReports, harassmentReports, legalConsultations } from "../../db/schema";
import { eq, desc, and, ilike, count } from "drizzle-orm";

export const config = { path: "/api/admin-report-list-by-status" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "신고 현황 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "허용되지 않는 메서드" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const reportType = url.searchParams.get("reportType") || url.searchParams.get("type") || "all";
  const statusFilter = url.searchParams.get("status") || undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  // R41 Q2-019: 프론트가 보내는 limit 수용 (기본 30, 안전 상한 100)
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 30)));
  // R41 Q2-019: onlyAnonymous=1 이면 익명 신고만 (서버 필터)
  const onlyAnonymous = url.searchParams.get("onlyAnonymous") === "1";
  // R41 Q2-019: q 키워드(제목 부분일치)
  const keyword = (url.searchParams.get("q") || "").trim();
  // 단일 타입일 때만 page 기반 offset 적용 (all은 3종 합산이라 0)
  const offset = reportType === "all" ? 0 : (page - 1) * limit;
  const perTypeLimit = reportType === "all" ? Math.ceil(limit / 3) : limit;

  /**
   * 신고 테이블별 공통 WHERE 조건 빌더.
   * - status 필터
   * - onlyAnonymous=1 → is_anonymous=true
   * - q → title ILIKE %q%
   */
  function buildCond(table: any) {
    const conds: any[] = [];
    if (statusFilter) conds.push(eq(table.status, statusFilter as any));
    if (onlyAnonymous) conds.push(eq(table.isAnonymous, true));
    if (keyword) conds.push(ilike(table.title, `%${keyword}%`));
    if (conds.length === 0) return undefined;
    if (conds.length === 1) return conds[0];
    return and(...conds);
  }

  const results: any[] = [];
  let total = 0;

  // 사건 신고
  if (reportType === "all" || reportType === "incident") {
    const cond = buildCond(incidentReports);
    try {
      const rows = await db.select({
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
        .limit(perTypeLimit)
        .offset(offset);
      results.push(...rows.map((r) => ({ ...r, reportType: "incident" })));
    } catch (err) {
      console.warn("[admin-report-list-by-status] incident 조회 실패", err);
    }
    // R41 Q2-019: 별도 count로 정확한 total 산출
    try {
      const [c] = await db.select({ n: count() }).from(incidentReports).where(cond);
      total += Number(c?.n ?? 0);
    } catch (err) {
      console.warn("[admin-report-list-by-status] incident count 실패", err);
    }
  }

  // 괴롭힘 신고
  if (reportType === "all" || reportType === "harassment") {
    const cond = buildCond(harassmentReports);
    try {
      const rows = await db.select({
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
        .limit(perTypeLimit)
        .offset(offset);
      results.push(...rows.map((r) => ({ ...r, reportType: "harassment" })));
    } catch (err) {
      console.warn("[admin-report-list-by-status] harassment 조회 실패", err);
    }
    try {
      const [c] = await db.select({ n: count() }).from(harassmentReports).where(cond);
      total += Number(c?.n ?? 0);
    } catch (err) {
      console.warn("[admin-report-list-by-status] harassment count 실패", err);
    }
  }

  // 법률 상담
  if (reportType === "all" || reportType === "legal") {
    const cond = buildCond(legalConsultations);
    try {
      const rows = await db.select({
        id: legalConsultations.id,
        reportNo: legalConsultations.consultationNo,
        title: legalConsultations.title,
        status: legalConsultations.status,
        isAnonymous: legalConsultations.isAnonymous,
        // R41 Q2-021: legalConsultations엔 aiSeverity 컬럼 없음 → aiUrgency로 매핑 (런타임 컬럼 오류 방지)
        aiSeverity: legalConsultations.aiUrgency,
        createdAt: legalConsultations.createdAt,
        updatedAt: legalConsultations.updatedAt,
      })
        .from(legalConsultations)
        .where(cond)
        .orderBy(desc(legalConsultations.createdAt))
        .limit(perTypeLimit)
        .offset(offset);
      results.push(...rows.map((r) => ({ ...r, reportType: "legal" })));
    } catch (err) {
      console.warn("[admin-report-list-by-status] legal 조회 실패", err);
    }
    try {
      const [c] = await db.select({ n: count() }).from(legalConsultations).where(cond);
      total += Number(c?.n ?? 0);
    } catch (err) {
      console.warn("[admin-report-list-by-status] legal count 실패", err);
    }
  }

  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return new Response(jsonKST({ ok: true, page, limit, total, items: results }), {
    headers: { "Content-Type": "application/json" },
  });
};
