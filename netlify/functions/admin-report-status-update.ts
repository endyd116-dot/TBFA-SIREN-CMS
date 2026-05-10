// admin-report-status-update.ts — 신고 단계 변경 + 이력 기록 + 사용자 알림
// PATCH /api/admin-report-status-update
// body: { reportType: 'incident'|'harassment'|'legal', reportId, toStatus, note? }
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import {
  incidentReports, harassmentReports, legalConsultations,
  reportStatusLogs, members,
} from "../../db/schema";
import { eq } from "drizzle-orm";
import { createNotification } from "../../lib/notify";

export const config = { path: "/api/admin-report-status-update" };

const REPORT_TABLES = {
  incident:   incidentReports,
  harassment: harassmentReports,
  legal:      legalConsultations,
} as const;

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
  const toStatus: string = body.toStatus;
  const note: string | undefined = body.note;

  if (!["incident", "harassment", "legal"].includes(reportType) || !reportId || !toStatus) {
    return new Response(JSON.stringify({ ok: false, error: "reportType, reportId, toStatus 필수" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
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
    }).returning({ id: reportStatusLogs.id });
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
      await createNotification({
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
      notified = true;
      // notified_at 갱신
      if (logId) {
        await db.update(reportStatusLogs)
          .set({ notifiedAt: new Date() })
          .where(eq(reportStatusLogs.id, logId));
      }
    } catch (err) {
      console.warn("[admin-report-status-update] 알림 발송 실패", err);
    }
  }

  return new Response(JSON.stringify({ ok: true, changed: true, fromStatus, toStatus, notified }), {
    headers: { "Content-Type": "application/json" },
  });
};
