// user-my-reports.ts — 사용자 본인 신고 목록 (3종 통합 + 단계 확인)
// GET /api/user-my-reports?type=all|incident|harassment|legal&page=1
import { requireActiveUser } from "../../lib/auth";
import { db } from "../../db";
import { incidentReports, harassmentReports, legalConsultations } from "../../db/schema";
import { eq, desc, count, sql } from "drizzle-orm";

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
  /* R41 Q2-012: 클라 page size(limit)와 서버 paging 정합 — 미지정 시 20, 안전 상한 50 */
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));
  const offset = (page - 1) * limit;

  const results: any[] = [];
  /* R41 Q2-012: 전체 건수(total) — 타입별 count 합산 (페이지네이션용) */
  let total = 0;

  // 사건 신고
  if (type === "all" || type === "incident") {
    let rows: any[] = [];
    try {
      rows = await db.select({
        id: incidentReports.id,
        reportNo: incidentReports.reportNo,
        title: incidentReports.title,
        contentHtml: incidentReports.contentHtml,   /* P1-6: 수정 모달 본문 채움용 */
        category: incidentReports.category,
        status: incidentReports.status,
        isAnonymous: incidentReports.isAnonymous,
        aiSummary: incidentReports.aiSummary,       /* R41 Q2-012: AI 요약 카드 표시용 */
        aiSeverity: incidentReports.aiSeverity,     /* R41 Q2-012 */
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
    /* R41 Q2-012: 사건 신고 전체 건수 */
    try {
      const [c]: any = await db.select({ c: count() }).from(incidentReports).where(eq(incidentReports.memberId, memberId));
      total += Number(c?.c || 0);
    } catch (err) { console.warn("[user-my-reports] incident count 실패", err); }
  }

  // 괴롭힘 신고
  if (type === "all" || type === "harassment") {
    let rows: any[] = [];
    try {
      rows = await db.select({
        id: harassmentReports.id,
        reportNo: harassmentReports.reportNo,
        title: harassmentReports.title,
        contentHtml: harassmentReports.contentHtml,   /* P1-6: 수정 모달 본문 채움용 */
        category: harassmentReports.category,
        status: harassmentReports.status,
        isAnonymous: harassmentReports.isAnonymous,
        aiSummary: harassmentReports.aiSummary,       /* R41 Q2-012: AI 요약 카드 표시용 */
        aiSeverity: harassmentReports.aiSeverity,     /* R41 Q2-012 */
        occurredAt: harassmentReports.occurredAt,     /* R41 Q2-011: 수정 모달 발생일·빈도 채움용 */
        frequency: harassmentReports.frequency,       /* R41 Q2-011 */
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
    /* R41 Q2-012: 괴롭힘 신고 전체 건수 */
    try {
      const [c]: any = await db.select({ c: count() }).from(harassmentReports).where(eq(harassmentReports.memberId, memberId));
      total += Number(c?.c || 0);
    } catch (err) { console.warn("[user-my-reports] harassment count 실패", err); }
  }

  // 법률 상담
  if (type === "all" || type === "legal") {
    let rows: any[] = [];
    try {
      rows = await db.select({
        id: legalConsultations.id,
        reportNo: legalConsultations.consultationNo,
        title: legalConsultations.title,
        contentHtml: legalConsultations.contentHtml,   /* P1-6: 수정 모달 본문 채움용 */
        category: legalConsultations.category,
        status: legalConsultations.status,
        isAnonymous: legalConsultations.isAnonymous,
        aiSummary: legalConsultations.aiSummary,       /* R41 Q2-012: AI 요약 카드 표시용 */
        aiUrgency: legalConsultations.aiUrgency,       /* R41 Q2-012 */
        urgency: legalConsultations.urgency,           /* R41 Q2-011: 수정 모달 긴급도 채움용 */
        partyInfo: legalConsultations.partyInfo,       /* R41 Q2-011: 수정 모달 당사자정보 채움용 */
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
    /* R41 Q2-012: 법률 상담 전체 건수 */
    try {
      const [c]: any = await db.select({ c: count() }).from(legalConsultations).where(eq(legalConsultations.memberId, memberId));
      total += Number(c?.c || 0);
    } catch (err) { console.warn("[user-my-reports] legal count 실패", err); }
  }

  // createdAt 내림차순 정렬 (all 모드)
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  /* 2026-06-27: 반려 사유 노출 — 반려 시 사유는 report_status_logs.note(to_status='rejected')에
     보존됨(AD-014). 신고별 최신 반려 note를 rejectedReason로 부착해 마이페이지 타임라인에 표시.
     실패해도 목록은 정상 반환(보조 조회). */
  try {
    const rejected = results.filter((r) => r.status === "rejected");
    if (rejected.length) {
      const byType: Record<string, number[]> = { incident: [], harassment: [], legal: [] };
      for (const r of rejected) {
        if (byType[r.reportType]) byType[r.reportType].push(Number(r.id));
      }
      const reasonMap = new Map<string, string | null>();
      for (const t of Object.keys(byType)) {
        const ids = byType[t];
        if (!ids.length) continue;
        const logs: any = await db.execute(sql`
          SELECT DISTINCT ON (report_id) report_id, note
            FROM report_status_logs
           WHERE report_type = ${t} AND to_status = 'rejected'
             AND report_id = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})
           ORDER BY report_id, created_at DESC
        `);
        for (const row of (logs?.rows ?? logs ?? [])) {
          reasonMap.set(`${t}:${row.report_id}`, row.note ?? null);
        }
      }
      for (const r of results) {
        if (r.status === "rejected") r.rejectedReason = reasonMap.get(`${r.reportType}:${r.id}`) ?? null;
      }
    }
  } catch (err) {
    console.warn("[user-my-reports] 반려사유 부착 실패(무시):", err);
  }

  /* R41 Q2-012: total·limit·totalPages 추가 (페이지네이션이 실제 전체 건수 사용) */
  return new Response(JSON.stringify({
    ok: true,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    items: results,
  }), {
    headers: { "Content-Type": "application/json" },
  });
};
