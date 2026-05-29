// netlify/functions/incident-report-confirm.ts
// ★ M-5 (B안): 사용자가 AI 답변을 본 후 사이렌 정식 접수 여부 결정
// - sirenReportRequested = true → 운영자 알림 발송 + status='reviewing'
// - sirenReportRequested = false → AI 답변만 받고 종료 (status='closed')

import type { Context } from "@netlify/functions";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../../db";
import { incidentReports } from "../../db/schema";
import { requireActiveUser } from "../../lib/auth";
import { notifyAllOperators, createNotification } from "../../lib/notify";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/incident-report-confirm" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  /* ★ R41 Q2-043: 차단(블랙) 사용자 차단 — requireActiveUser 패턴 */
  const _r = await requireActiveUser(req);
  if (!_r.ok) return (_r as { ok: false; res: Response }).res;
  const user = _r.user;

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const reportId = Number(body.reportId);
    const requested = body.sirenReportRequested === true;

    if (!Number.isFinite(reportId)) return badRequest("reportId가 유효하지 않습니다");

    /* 본인 제보 존재 확인 (알림 메시지·로그용 reportNo/title 확보) */
    const [row] = await db.select().from(incidentReports)
      .where(and(eq(incidentReports.id, reportId), eq(incidentReports.memberId, user.uid)))
      .limit(1);

    if (!row) return notFound("제보를 찾을 수 없습니다");

    /* ★ R41 Q2-046: select→update 비원자 경합 제거 — siren_report_requested IS NULL 조건으로 원자적 갱신.
       이미 결정된 건이면 affected 0 (RETURNING 비어있음) → 중복 처리 차단 */
    const updateData: any = {
      sirenReportRequested: requested,
      sirenReportRequestedAt: new Date(),
      status: requested ? "reviewing" : "closed",
    };
    const updatedRows = await db.update(incidentReports)
      .set(updateData)
      .where(and(
        eq(incidentReports.id, reportId),
        eq(incidentReports.memberId, user.uid),
        isNull(incidentReports.sirenReportRequested),
      ))
      .returning({ id: incidentReports.id });
    if (updatedRows.length === 0) {
      return forbidden("이미 결정이 완료된 제보입니다");
    }

    /* 정식 접수 시 운영자 알림 */
    if (requested) {
// netlify/functions/incident-report-confirm.ts — notifyAllOperators 호출부 교체
      try {
        const severity = (row as any).aiSeverity || "medium";
        const isCritical = severity === "critical";
        const isHigh = severity === "high";

        await notifyAllOperators({
          category: "support",
          severity: isCritical ? "critical" : (isHigh ? "warning" : "info"),
          title: `${isCritical ? "🚨" : isHigh ? "⚠️" : "📋"} 사건 제보 정식 접수: ${(row as any).reportNo}`,
          message: `${(row as any).title} (위급도: ${severity.toUpperCase()})`,
          link: `/admin.html#incident-reports`,
          refTable: "incident_reports",
          refId: reportId,
        }, {
          /* ★ M-15: incident 담당 운영자 + super_admin에게만 발송 */
          category: "incident",
        });
      } catch (e) {
        console.warn("[incident-report-confirm] 알림 실패", e);
      }

      /* ★ US-021: 신고자 본인에게도 '정식 접수·검토 시작' 1회 통지 (기존엔 운영자에게만 알림이 가서
         신고자는 운영자가 단계를 수동으로 바꾸기 전까지 진행 통지를 못 받았음). */
      try {
        await createNotification({
          recipientId: user.uid,
          recipientType: "user",
          category: "system",
          severity: "info",
          title: "사건 제보가 정식 접수되었습니다",
          message: `'${(row as any).reportNo}' 제보가 사이렌에 정식 접수되어 운영진 검토가 시작되었습니다.`,
          link: "/my-reports.html",
          refTable: "incident_reports",
          refId: reportId,
          expiresInDays: 60,
        });
      } catch (e) { console.warn("[incident-report-confirm] 신고자 알림 예외(무시):", e); }
    }

    /* 감사 로그 */
    try {
      /* ★ R41 Q2-044: 행위자 표기를 리터럴 "user" 대신 실제 회원명으로 */
      await logUserAction(req, user.uid, user.name || "user", "incident_report_confirm", {
        target: (row as any).reportNo,
        detail: { sirenReportRequested: requested },
        success: true,
      });
    } catch (_) {}

    return ok({
      reportId,
      reportNo: (row as any).reportNo,
      sirenReportRequested: requested,
      status: updateData.status,
    }, requested ? "사이렌에 정식 접수되었습니다" : "AI 분석으로 종료 처리되었습니다");
  } catch (e: any) {
    console.error("[incident-report-confirm]", e);
    return serverError("처리 실패", e);
  }
};