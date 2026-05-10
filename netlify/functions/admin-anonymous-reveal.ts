// admin-anonymous-reveal.ts — 익명 신고자 신원 단계적 식별 + 감사 로그
// POST /api/admin-anonymous-reveal
// body: { reportType: 'incident'|'harassment'|'legal', reportId, revealLevel: 1|2, reason }
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import {
  incidentReports, harassmentReports, legalConsultations,
  anonymousRevealLogs, members,
} from "../../db/schema";
import { eq } from "drizzle-orm";

export const config = { path: "/api/admin-anonymous-reveal" };

const REPORT_TABLES = {
  incident:   incidentReports,
  harassment: harassmentReports,
  legal:      legalConsultations,
} as const;

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "신원 식별 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "허용되지 않는 메서드" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  const adminId = auth.ctx.admin.uid as number;

  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return jsonError("parse_body", err);
  }

  const reportType = body.reportType as "incident" | "harassment" | "legal";
  const reportId = Number(body.reportId);
  const revealLevel = Number(body.revealLevel);
  const reason: string | undefined = body.reason;

  if (!["incident", "harassment", "legal"].includes(reportType) || !reportId || ![1, 2].includes(revealLevel)) {
    return new Response(JSON.stringify({ ok: false, error: "reportType, reportId, revealLevel(1|2) 필수" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const table = REPORT_TABLES[reportType];

  // 신고 조회
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
  if (!report.isAnonymous) {
    return new Response(JSON.stringify({ ok: false, error: "익명 신고가 아닙니다." }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // 신고자 회원 정보 조회
  let reporter: any;
  if (report.memberId) {
    try {
      const rows = await db.select({
        id: members.id,
        name: members.name,
        email: members.email,
        phone: members.phone,
        type: members.type,
        status: members.status,
      })
        .from(members)
        .where(eq(members.id, report.memberId))
        .limit(1);
      reporter = rows[0];
    } catch (err) {
      console.warn("[admin-anonymous-reveal] 신고자 조회 실패", err);
    }
  }

  // IP 추출 (Netlify 헤더)
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-nf-client-connection-ip") ||
    undefined;

  // 감사 로그 기록
  try {
    await db.insert(anonymousRevealLogs).values({
      reportType,
      reportId,
      revealLevel,
      revealedBy: adminId,
      reason,
      ipAddress,
    });
  } catch (err) {
    return jsonError("insert_audit_log", err);
  }

  // 공개 범위 결정
  const responseData: any = { ok: true, revealLevel };
  if (revealLevel >= 1 && reporter) {
    // 레벨 1: 이름 + 회원 유형
    responseData.reporter = {
      id: reporter.id,
      name: reporter.name,
      type: reporter.type,
      status: reporter.status,
    };
  }
  if (revealLevel >= 2 && reporter) {
    // 레벨 2: 모든 정보 추가
    responseData.reporter.email = reporter.email;
    responseData.reporter.phone = reporter.phone;
    // 신고 원본의 reporterName·Phone·Email도 포함
    responseData.reporterName = report.reporterName;
    responseData.reporterPhone = report.reporterPhone;
    responseData.reporterEmail = report.reporterEmail;
  }

  return new Response(JSON.stringify(responseData), {
    headers: { "Content-Type": "application/json" },
  });
};
