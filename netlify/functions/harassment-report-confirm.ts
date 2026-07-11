// netlify/functions/harassment-report-confirm.ts
// Phase M-6: 사이렌 정식 신고 여부 결정

import type { Context } from "@netlify/functions";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../../db";
import { harassmentReports } from "../../db/schema";
import { requireActiveUser } from "../../lib/auth";
import { notifyAllOperators, createNotification } from "../../lib/notify";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/harassment-report-confirm" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  /* R41 Q2-043: 차단(블랙) 사용자 차단 — requireActiveUser 패턴 */
  const _r = await requireActiveUser(req);
  if (!_r.ok) return (_r as { ok: false; res: Response }).res;
  const user = _r.user;

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const reportId = Number(body.reportId);
    const requested = body.sirenReportRequested === true;

    if (!Number.isFinite(reportId)) return badRequest("reportId가 유효하지 않습니다");

    /* 본인 신고 존재 확인 (알림 메시지·로그용 reportNo/title 확보) */
    const [row] = await db.select().from(harassmentReports)
      .where(and(eq(harassmentReports.id, reportId), eq(harassmentReports.memberId, user.uid)))
      .limit(1);

    if (!row) return notFound("신고를 찾을 수 없습니다");

    /* R41 Q2-046: select→update 비원자 경합 제거 — siren_report_requested IS NULL 원자 갱신 */
    const updateData: any = {
      sirenReportRequested: requested,
      sirenReportRequestedAt: new Date(),
      status: requested ? "reviewing" : "closed",
    };
    const updatedRows = await db.update(harassmentReports)
      .set(updateData)
      .where(and(
        eq(harassmentReports.id, reportId),
        eq(harassmentReports.memberId, user.uid),
        isNull(harassmentReports.sirenReportRequested),
      ))
      .returning({ id: harassmentReports.id });
    if (updatedRows.length === 0) {
      return forbidden("이미 결정이 완료된 신고입니다");
    }

    if (requested) {
// netlify/functions/harassment-report-confirm.ts — notifyAllOperators 호출부 교체
      try {
        const sev = (row as any).aiSeverity || "medium";
        const isCritical = sev === "critical";
        const isHigh = sev === "high";

        await notifyAllOperators({
          category: "support",
          severity: isCritical ? "critical" : (isHigh ? "warning" : "info"),
          title: `악성민원 신고 정식 접수: ${(row as any).reportNo}`,
          message: `${(row as any).title} (심각도: ${sev.toUpperCase()})`,
          link: `/admin.html#harassment-reports`,
          refTable: "harassment_reports",
          refId: reportId,
        }, {
          /* M-15: harassment 담당 운영자 + super_admin에게만 발송 */
          category: "harassment",
        });
      } catch (e) {
        console.warn("[harassment-report-confirm] 알림 실패", e);
      }

      /* US-021: 신고자 본인에게도 '정식 접수·검토 시작' 1회 통지 */
      try {
        await createNotification({
          recipientId: user.uid,
          recipientType: "user",
          category: "system",
          severity: "info",
          title: "악성민원 신고가 정식 접수되었습니다",
          message: `'${(row as any).reportNo}' 신고가 사이렌에 정식 접수되어 운영진 검토가 시작되었습니다.`,
          link: "/my-reports.html",
          refTable: "harassment_reports",
          refId: reportId,
          expiresInDays: 60,
        });
      } catch (e) { console.warn("[harassment-report-confirm] 신고자 알림 예외(무시):", e); }
    }

    try {
      /* R41 Q2-044: 행위자 표기를 리터럴 "user" 대신 실제 회원명으로 */
      await logUserAction(req, user.uid, user.name || "user", "harassment_report_confirm", {
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