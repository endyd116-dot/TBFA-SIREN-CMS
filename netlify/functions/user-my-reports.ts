// user-my-reports.ts — 사용자 본인 신고 목록 (3종 통합 + 단계 확인)
// GET /api/user-my-reports?type=all|incident|harassment|legal&page=1
import { requireActiveUser } from "../../lib/auth";
import { db } from "../../db";
import { incidentReports, harassmentReports, legalConsultations } from "../../db/schema";
import { eq, desc } from "drizzle-orm";

export const config = { path: "/api/user-my-reports" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "내 신고 목록 조회 실패", step,
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

  let auth: any;
  try {
    auth = await requireActiveUser(req);
  } catch (err) {
    return jsonError("auth", err);
  }
  if (!auth.ok) return auth.res;

  const memberId = auth.user.uid as number;
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "all";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = 20;
  const offset = (page - 1) * limit;

  const results: any[] = [];

  // 사건 신고
  if (type === "all" || type === "incident") {
    let rows: any[] = [];
    try {
      rows = await db.select({
        id: incidentReports.id,
        reportNo: incidentReports.reportNo,
        title: incidentReports.title,
        contentHtml: incidentReports.contentHtml,   /* ★ P1-6: 수정 모달 본문 채움용 */
        category: incidentReports.category,
        status: incidentReports.status,
        isAnonymous: incidentReports.isAnonymous,
        adminResponse: incidentReports.adminResponse,
        respondedAt: incidentReports.respondedAt,
        createdAt: incidentReports.createdAt,
        updatedAt: incidentReports.updatedAt,
      })
        .from(incidentReports)
        .where(eq(incidentReports.memberId, memberId))
        .orderBy(desc(incidentReports.createdAt))
        .limit(limit)
        .offset(offset);
    } catch (err) {
      console.warn("[user-my-reports] incident 조회 실패", err);
    }
    results.push(...rows.map((r) => ({ ...r, reportType: "incident" })));
  }

  // 괴롭힘 신고
  if (type === "all" || type === "harassment") {
    let rows: any[] = [];
    try {
      rows = await db.select({
        id: harassmentReports.id,
        reportNo: harassmentReports.reportNo,
        title: harassmentReports.title,
        contentHtml: harassmentReports.contentHtml,   /* ★ P1-6: 수정 모달 본문 채움용 */
        category: harassmentReports.category,
        status: harassmentReports.status,
        isAnonymous: harassmentReports.isAnonymous,
        adminResponse: harassmentReports.adminResponse,
        respondedAt: harassmentReports.respondedAt,
        createdAt: harassmentReports.createdAt,
        updatedAt: harassmentReports.updatedAt,
      })
        .from(harassmentReports)
        .where(eq(harassmentReports.memberId, memberId))
        .orderBy(desc(harassmentReports.createdAt))
        .limit(limit)
        .offset(offset);
    } catch (err) {
      console.warn("[user-my-reports] harassment 조회 실패", err);
    }
    results.push(...rows.map((r) => ({ ...r, reportType: "harassment" })));
  }

  // 법률 상담
  if (type === "all" || type === "legal") {
    let rows: any[] = [];
    try {
      rows = await db.select({
        id: legalConsultations.id,
        reportNo: legalConsultations.consultationNo,
        title: legalConsultations.title,
        contentHtml: legalConsultations.contentHtml,   /* ★ P1-6: 수정 모달 본문 채움용 */
        category: legalConsultations.category,
        status: legalConsultations.status,
        isAnonymous: legalConsultations.isAnonymous,
        adminResponse: legalConsultations.adminResponse,
        respondedAt: legalConsultations.respondedAt,
        assignedLawyerName: legalConsultations.assignedLawyerName,
        createdAt: legalConsultations.createdAt,
        updatedAt: legalConsultations.updatedAt,
      })
        .from(legalConsultations)
        .where(eq(legalConsultations.memberId, memberId))
        .orderBy(desc(legalConsultations.createdAt))
        .limit(limit)
        .offset(offset);
    } catch (err) {
      console.warn("[user-my-reports] legal 조회 실패", err);
    }
    results.push(...rows.map((r) => ({ ...r, reportType: "legal" })));
  }

  // createdAt 내림차순 정렬 (all 모드)
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return new Response(JSON.stringify({ ok: true, page, items: results }), {
    headers: { "Content-Type": "application/json" },
  });
};
