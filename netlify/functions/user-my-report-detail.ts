// user-my-report-detail.ts — 사용자 본인 신고 상세 + 단계 타임라인
// GET /api/user-my-report-detail?reportType=incident|harassment|legal&reportId=1
import { requireActiveUser } from "../../lib/auth";
import { db } from "../../db";
import {
  incidentReports, harassmentReports, legalConsultations,
  reportStatusLogs,
} from "../../db/schema";
import { and, eq, asc } from "drizzle-orm";

export const config = { path: "/api/user-my-report-detail" };

const REPORT_TABLES = {
  incident:   incidentReports,
  harassment: harassmentReports,
  legal:      legalConsultations,
} as const;

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "신고 상세 조회 실패", step,
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
  const reportType = url.searchParams.get("reportType") as "incident" | "harassment" | "legal" | null;
  const reportId = url.searchParams.get("reportId") ? Number(url.searchParams.get("reportId")) : undefined;

  if (!reportType || !["incident", "harassment", "legal"].includes(reportType) || !reportId) {
    return new Response(JSON.stringify({ ok: false, error: "reportType, reportId 필수" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const table = REPORT_TABLES[reportType];

  // 신고 기본 정보 조회
  let report: any;
  try {
    const rows = await db.select()
      .from(table as any)
      .where(eq((table as any).id, reportId))
      .limit(1);
    report = rows[0];
  } catch (err) {
    return jsonError("select_report", err);
  }
  if (!report) {
    return new Response(JSON.stringify({ ok: false, error: "신고 없음" }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }

  // 본인 신고인지 확인
  if (report.memberId !== memberId) {
    return new Response(JSON.stringify({ ok: false, error: "권한 없음" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  // 단계 타임라인 조회
  let timeline: any[] = [];
  try {
    timeline = await db.select({
      id: reportStatusLogs.id,
      fromStatus: reportStatusLogs.fromStatus,
      toStatus: reportStatusLogs.toStatus,
      note: reportStatusLogs.note,
      notifiedAt: reportStatusLogs.notifiedAt,
      createdAt: reportStatusLogs.createdAt,
    })
      .from(reportStatusLogs)
      .where(and(eq(reportStatusLogs.reportType, reportType), eq(reportStatusLogs.reportId, reportId)))
      .orderBy(asc(reportStatusLogs.createdAt))
      .limit(100);
  } catch (err) {
    console.warn("[user-my-report-detail] timeline 조회 실패", err);
  }

  // 익명 신고 시 개인정보 필드 마스킹 (보안)
  const safeReport = { ...report };
  if (report.isAnonymous) {
    safeReport.reporterPhone = undefined;
    safeReport.reporterEmail = undefined;
  }
  // AI 분석 결과는 공개 (사용자에게 유익)
  // 어드민 메모·응답 관련 필드는 그대로 노출 (공개 범위 정책상)

  return new Response(JSON.stringify({
    ok: true,
    report: safeReport,
    timeline,
  }), { headers: { "Content-Type": "application/json" } });
};
