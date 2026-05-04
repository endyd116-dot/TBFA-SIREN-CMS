// netlify/functions/harassment-report-confirm.ts
// ★ Phase M-6: 사이렌 정식 신고 여부 결정

import type { Context } from "@netlify/functions";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { harassmentReports } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { notifyAllOperators } from "../../lib/notify";
import {
  ok, badRequest, unauthorized, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/harassment-report-confirm" };

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

    const [row] = await db.select().from(harassmentReports)
      .where(and(eq(harassmentReports.id, reportId), eq(harassmentReports.memberId, user.uid)))
      .limit(1);

    if (!row) return notFound("신고를 찾을 수 없습니다");
    if ((row as any).sirenReportRequested !== null && (row as any).sirenReportRequested !== undefined) {
      return forbidden("이미 결정이 완료된 신고입니다");
    }

    const updateData: any = {
      sirenReportRequested: requested,
      sirenReportRequestedAt: new Date(),
      status: requested ? "reviewing" : "closed",
    };
    await db.update(harassmentReports).set(updateData).where(eq(harassmentReports.id, reportId));

    if (requested) {
// netlify/functions/harassment-report-confirm.ts — notifyAllOperators 호출부 교체
      try {
        const sev = (row as any).aiSeverity || "medium";
        const isCritical = sev === "critical";
        const isHigh = sev === "high";

        await notifyAllOperators({
          category: "support",
          severity: isCritical ? "critical" : (isHigh ? "warning" : "info"),
          title: `${isCritical ? "🚨" : isHigh ? "⚠️" : "📢"} 악성민원 신고 정식 접수: ${(row as any).reportNo}`,
          message: `${(row as any).title} (심각도: ${sev.toUpperCase()})`,
          link: `/admin.html#harassment-reports`,
          refTable: "harassment_reports",
          refId: reportId,
        }, {
          /* ★ M-15: harassment 담당 운영자 + super_admin에게만 발송 */
          category: "harassment",
        });
      } catch (e) {
        console.warn("[harassment-report-confirm] 알림 실패", e);
      }
    }

    try {
      await logUserAction(req, user.uid, "user", "harassment_report_confirm", {
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
    }, requested ? "사이렌에 정식 신고되었습니다" : "AI 답변으로 종료 처리되었습니다");
  } catch (e: any) {
    console.error("[harassment-report-confirm]", e);
    return serverError("처리 실패", e);
  }
};