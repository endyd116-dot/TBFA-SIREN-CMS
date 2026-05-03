// netlify/functions/incident-report-confirm.ts
// ★ M-5 (B안): 사용자가 AI 답변을 본 후 사이렌 정식 접수 여부 결정
// - sirenReportRequested = true → 운영자 알림 발송 + status='reviewing'
// - sirenReportRequested = false → AI 답변만 받고 종료 (status='closed')

import type { Context } from "@netlify/functions";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { incidentReports } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { notifyAllOperators } from "../../lib/notify";
import {
  ok, badRequest, unauthorized, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/incident-report-confirm" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const reportId = Number(body.reportId);
    const requested = body.sirenReportRequested === true;

    if (!Number.isFinite(reportId)) return badRequest("reportId가 유효하지 않습니다");

    /* 본인 제보만 수정 가능 */
    const [row] = await db.select().from(incidentReports)
      .where(and(eq(incidentReports.id, reportId), eq(incidentReports.memberId, user.uid)))
      .limit(1);

    if (!row) return notFound("제보를 찾을 수 없습니다");
    if ((row as any).sirenReportRequested !== null && (row as any).sirenReportRequested !== undefined) {
      return forbidden("이미 결정이 완료된 제보입니다");
    }

    /* 상태 갱신 */
    const updateData: any = {
      sirenReportRequested: requested,
      sirenReportRequestedAt: new Date(),
      status: requested ? "reviewing" : "closed",
    };
    await db.update(incidentReports).set(updateData).where(eq(incidentReports.id, reportId));

    /* 정식 접수 시 운영자 알림 */
    if (requested) {
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
        });
      } catch (e) {
        console.warn("[incident-report-confirm] 알림 실패", e);
      }
    }

    /* 감사 로그 */
    try {
      await logUserAction(req, user.uid, "user", "incident_report_confirm", {
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