// admin-report-status-update.ts — 신고 단계 변경 + 이력 기록 + 사용자 알림
// PATCH /api/admin-report-status-update
// body: { reportType: 'incident'|'harassment'|'legal', reportId, toStatus, note? }
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import {
  incidentReports, harassmentReports, legalConsultations,
  reportStatusLogs, members,
} from "../../db/schema";
import { eq } from "drizzle-orm";
import { createNotification } from "../../lib/notify";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-report-status-update" };

const REPORT_TABLES = {
  incident:   incidentReports,
  harassment: harassmentReports,
  legal:      legalConsultations,
} as const;

/* ★ R41 Q2-022: reportType별 허용 status 화이트리스트 (DB enum과 1:1).
   incident/harassment 신고 enum과 legal 상담 enum이 다르다(legal에만 matching/matched/in_progress). */
const VALID_STATUSES: Record<"incident" | "harassment" | "legal", string[]> = {
  incident:   ["submitted", "ai_analyzed", "reviewing", "responded", "closed", "rejected"],
  harassment: ["submitted", "ai_analyzed", "reviewing", "responded", "closed", "rejected"],
  legal:      ["submitted", "ai_analyzed", "reviewing", "responded", "closed", "rejected", "matching", "matched", "in_progress"],
};

const STATUS_LABELS: Record<string, string> = {
  submitted:    "접수",
  ai_analyzed:  "AI 분석 완료",
  reviewing:    "검토 중",
  in_progress:  "처리 중",
  responded:    "처리 완료",
  closed:       "종결",
  rejected:     "반려",
};

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "단계 변경 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request) => {
  if (req.method !== "PATCH") {
    return new Response(JSON.stringify({ ok: false, error: "허용되지 않는 메서드" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const adminId = auth.ctx.admin.uid as number;
  const adminName = (auth.ctx.admin.name as string) || "관리자";

  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return jsonError("parse_body", err);
  }

  const reportType = body.reportType as "incident" | "harassment" | "legal";
  const reportId = Number(body.reportId);
  const toStatus: string = body.toStatus;
  const note: string | undefined = body.note;

  if (!["incident", "harassment", "legal"].includes(reportType) || !reportId || !toStatus) {
    return new Response(JSON.stringify({ ok: false, error: "reportType, reportId, toStatus 필수" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // ★ R41 Q2-022: toStatus를 reportType별 허용 status 화이트리스트와 대조
  if (!VALID_STATUSES[reportType].includes(toStatus)) {
    return new Response(JSON.stringify({
      ok: false,
      error: `허용되지 않는 상태값입니다 (${reportType})`,
      detail: `허용: ${VALID_STATUSES[reportType].join(", ")}`,
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const table = REPORT_TABLES[reportType];

  // 현재 상태 조회
  let current: any;
  try {
    const rows = await db.select({ id: (table as any).id, status: (table as any).status, memberId: (table as any).memberId })
      .from(table as any)
      .where(eq((table as any).id, reportId))
      .limit(1);
    current = rows[0];
  } catch (err) {
    return jsonError("select_current", err);
  }
  if (!current) {
    return new Response(JSON.stringify({ ok: false, error: "신고 없음" }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }

  const fromStatus = current.status as string;
  if (fromStatus === toStatus) {
    return new Response(JSON.stringify({ ok: true, changed: false, message: "이미 해당 단계입니다." }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // 단계 변경
  try {
    await db.update(table as any)
      .set({ status: toStatus, updatedAt: new Date() } as any)
      .where(eq((table as any).id, reportId));
  } catch (err) {
    return jsonError("update_status", err);
  }

  // 이력 기록
  let logId: number | undefined;
  try {
    const inserted = await db.insert(reportStatusLogs).values({
      reportType,
      reportId,
      fromStatus,
      toStatus,
      changedBy: adminId,
      note,
    } as any).returning({ id: reportStatusLogs.id });
    logId = inserted[0]?.id;
  } catch (err) {
    console.warn("[admin-report-status-update] 이력 기록 실패", err);
  }

  // 사용자 알림 (신고자 본인에게)
  const memberId: number | undefined = current.memberId;
  let notified = false;
  if (memberId) {
    try {
      const typeLabel = reportType === "incident" ? "사건 신고" : reportType === "harassment" ? "괴롭힘 신고" : "법률 상담";
      const statusLabel = STATUS_LABELS[toStatus] || toStatus;
      // ★ R41 Q2-032: createNotification 반환값(number|null)으로 실제 발송 여부 판정
      const nid = await createNotification({
        recipientId: memberId,
        recipientType: "user",
        category: "system",
        severity: "info",
        title: `${typeLabel} 처리 단계가 변경됐습니다`,
        message: `[${STATUS_LABELS[fromStatus] || fromStatus}] → [${statusLabel}]`,
        link: `/my-reports.html`,
        refTable: reportType === "incident" ? "incident_reports" : reportType === "harassment" ? "harassment_reports" : "legal_consultations",
        refId: reportId,
        expiresInDays: 60,
      });
      notified = !!nid;
      // notified_at 갱신 (실제 알림 생성된 경우에만)
      if (nid && logId) {
        await db.update(reportStatusLogs)
          .set({ notifiedAt: new Date() } as any)
          .where(eq(reportStatusLogs.id, logId));
      }
    } catch (err) {
      console.warn("[admin-report-status-update] 알림 발송 실패", err);
    }
  }

  // ★ R41 Q2-031: 상태 변경 성공 후 감사 로그 기록 (실패해도 본 흐름에 영향 없음)
  try {
    await logAdminAction(req, adminId, adminName, "report_status_update", {
      target: `${reportType}#${reportId}`,
      detail: { from: fromStatus, to: toStatus, notified },
    });
  } catch (err) {
    console.warn("[admin-report-status-update] 감사 로그 기록 실패", err);
  }

  return new Response(JSON.stringify({ ok: true, changed: true, fromStatus, toStatus, notified }), {
    headers: { "Content-Type": "application/json" },
  });
};
