// netlify/functions/legal-consultation-confirm.ts
// ★ Phase M-7: 변호사 매칭 신청 여부 결정

import type { Context } from "@netlify/functions";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../../db";
import { legalConsultations } from "../../db/schema";
import { requireActiveUser } from "../../lib/auth";
import { notifyAllOperators } from "../../lib/notify";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/legal-consultation-confirm" };

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

    const consultationId = Number(body.consultationId);
    const requested = body.sirenReportRequested === true;

    if (!Number.isFinite(consultationId)) return badRequest("consultationId가 유효하지 않습니다");

    /* 본인 상담 존재 확인 (알림 메시지·로그용 consultationNo/title 확보) */
    const [row] = await db.select().from(legalConsultations)
      .where(and(eq(legalConsultations.id, consultationId), eq(legalConsultations.memberId, user.uid)))
      .limit(1);

    if (!row) return notFound("상담 신청을 찾을 수 없습니다");

    /* ★ R41 Q2-046: select→update 비원자 경합 제거 — siren_report_requested IS NULL 원자 갱신 */
    const updateData: any = {
      sirenReportRequested: requested,
      sirenReportRequestedAt: new Date(),
      status: requested ? "matching" : "closed",
    };
    const updatedRows = await db.update(legalConsultations)
      .set(updateData)
      .where(and(
        eq(legalConsultations.id, consultationId),
        eq(legalConsultations.memberId, user.uid),
        isNull(legalConsultations.sirenReportRequested),
      ))
      .returning({ id: legalConsultations.id });
    if (updatedRows.length === 0) {
      return forbidden("이미 결정이 완료된 상담입니다");
    }

    if (requested) {
// netlify/functions/legal-consultation-confirm.ts — notifyAllOperators 호출부 교체
      try {
        const urg = (row as any).aiUrgency || "normal";
        const isUrgent = urg === "urgent";
        const isHigh = urg === "high";

        await notifyAllOperators({
          category: "support",
          severity: isUrgent ? "critical" : (isHigh ? "warning" : "info"),
          title: `${isUrgent ? "🚨" : isHigh ? "⚠️" : "⚖️"} 변호사 매칭 신청: ${(row as any).consultationNo}`,
          message: `${(row as any).title} (긴급도: ${urg.toUpperCase()})`,
          link: `/admin.html#legal-consultations`,
          refTable: "legal_consultations",
          refId: consultationId,
        }, {
          /* ★ M-15: legal 담당 운영자 + super_admin에게만 발송 */
          category: "legal",
        });
      } catch (e) {
        console.warn("[legal-consultation-confirm] 알림 실패", e);
      }
    }

    try {
      /* ★ R41 Q2-044: 행위자 표기를 리터럴 "user" 대신 실제 회원명으로 */
      await logUserAction(req, user.uid, user.name || "user", "legal_consultation_confirm", {
        target: (row as any).consultationNo,
        detail: { sirenReportRequested: requested },
        success: true,
      });
    } catch (_) {}

    return ok({
      consultationId,
      consultationNo: (row as any).consultationNo,
      sirenReportRequested: requested,
      status: updateData.status,
    }, requested ? "변호사 매칭이 신청되었습니다" : "AI 자문으로 종료 처리되었습니다");
  } catch (e: any) {
    console.error("[legal-consultation-confirm]", e);
    return serverError("처리 실패", e);
  }
};