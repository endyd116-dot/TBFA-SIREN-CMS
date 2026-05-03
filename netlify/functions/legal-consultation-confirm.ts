// netlify/functions/legal-consultation-confirm.ts
// ★ Phase M-7: 변호사 매칭 신청 여부 결정

import type { Context } from "@netlify/functions";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { legalConsultations } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { notifyAllOperators } from "../../lib/notify";
import {
  ok, badRequest, unauthorized, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/legal-consultation-confirm" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const consultationId = Number(body.consultationId);
    const requested = body.sirenReportRequested === true;

    if (!Number.isFinite(consultationId)) return badRequest("consultationId가 유효하지 않습니다");

    const [row] = await db.select().from(legalConsultations)
      .where(and(eq(legalConsultations.id, consultationId), eq(legalConsultations.memberId, user.uid)))
      .limit(1);

    if (!row) return notFound("상담 신청을 찾을 수 없습니다");
    if ((row as any).sirenReportRequested !== null && (row as any).sirenReportRequested !== undefined) {
      return forbidden("이미 결정이 완료된 상담입니다");
    }

    const updateData: any = {
      sirenReportRequested: requested,
      sirenReportRequestedAt: new Date(),
      status: requested ? "matching" : "closed",
    };
    await db.update(legalConsultations).set(updateData).where(eq(legalConsultations.id, consultationId));

    if (requested) {
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
        });
      } catch (e) {
        console.warn("[legal-consultation-confirm] 알림 실패", e);
      }
    }

    try {
      await logUserAction(req, user.uid, "user", "legal_consultation_confirm", {
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