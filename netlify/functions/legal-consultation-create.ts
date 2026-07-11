// netlify/functions/legal-consultation-create.ts
// Phase M-7: 법률 상담 신청 + AI 1차 자문

import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { legalConsultations, members } from "../../db/schema";
// netlify/functions/legal-consultation-create.ts — import 영역 교체
import { authenticateUser, requireActiveUser } from "../../lib/auth";
import { analyzeLegalConsultation } from "../../lib/ai-legal";
import { notifyAllOperators } from "../../lib/notify";
import { hasAnyCompletedDonation, getNonDonorPremiumNotice } from "../../lib/donor-check";
import {
  created, badRequest, unauthorized, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

function genConsultationNo(): string {
  const y = new Date().getFullYear();
  const r = String(Math.floor(Math.random() * 9000) + 1000);
  return `L-${y}-${r}`;
}

const VALID_CATEGORIES = ["school_dispute", "civil", "criminal", "family", "labor", "contract", "other"];
const VALID_URGENCY = ["urgent", "normal", "reference"];

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  /* 인증 + 차단 검증 (5순위 #1) */
  const _r = await requireActiveUser(req);
  if (!_r.ok) return (_r as { ok: false; res: Response }).res;
  const user = _r.user;

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const category = VALID_CATEGORIES.includes(body.category) ? body.category : "school_dispute";
    const urgency = VALID_URGENCY.includes(body.urgency) ? body.urgency : null;
    const partyInfo = String(body.partyInfo || "").trim().slice(0, 200) || null;
    const title = String(body.title || "").trim().slice(0, 200);
    const contentHtml = String(body.contentHtml || "").trim();
    const isAnonymous = !!body.isAnonymous;
    const skipAi = !!body.skipAi;
    const occurredAtRaw = body.occurredAt ? new Date(body.occurredAt) : null;
    const occurredAt = (occurredAtRaw && !isNaN(occurredAtRaw.getTime())) ? occurredAtRaw : null;
    const attachmentIds = Array.isArray(body.attachmentIds)
      ? body.attachmentIds.filter((x: any) => Number.isFinite(Number(x))).map(Number)
      : [];

    if (!title) return badRequest("제목은 필수입니다");
    if (!contentHtml || contentHtml.length < 10) return badRequest("내용을 10자 이상 입력해주세요");
    if (contentHtml.length > 100000) return badRequest("내용이 너무 깁니다 (최대 10만자)");

    const [me] = await db.select().from(members).where(eq(members.id, user.uid)).limit(1);
    const reporterName = isAnonymous ? null : (me as any)?.name || null;
    const reporterPhone = isAnonymous ? null : (me as any)?.phone || null;
    const reporterEmail = isAnonymous ? null : (me as any)?.email || null;

    const consultationNo = genConsultationNo();
    const insertData: any = {
      consultationNo,
      memberId: user.uid,
      category,
      urgency,
      occurredAt,
      partyInfo,
      title,
      contentHtml,
      attachmentIds: attachmentIds.length ? JSON.stringify(attachmentIds) : null,
      isAnonymous,
      reporterName,
      reporterPhone,
      reporterEmail,
      status: "submitted",
    };

    const [record] = await db.insert(legalConsultations).values(insertData).returning();
    const consultationId = (record as any).id;

    /* 운영자 인앱 알림 (2026-07-01) */
    try {
      await notifyAllOperators({
        category: "support",
        severity: "warning",
        title: `새 법률 상담 신청: ${consultationNo}`,
        message: `방금 법률 상담 신청이 접수됐어요. "${title}" — 확인이 필요해요.`,
        link: `/admin.html#legal-consultations`,
        refTable: "legal_consultations",
        refId: consultationId,
      }, { category: "legal" });
    } catch (e) {
      console.warn("[legal-consultation-create] 운영자 인앱 알림 실패:", e);
    }

    /* 운영자 카카오 알림톡 (승인 템플릿 있을 때만·no-op 안전) */
    try {
      const { sendOperatorAlimtalk, OPERATOR_KAKAO_EVENT_KEYS } = await import("../../lib/notify-operator-kakao");
      await sendOperatorAlimtalk(OPERATOR_KAKAO_EVENT_KEYS.SIREN_REPORT, {
        유형: "법률 상담 신청",
        제목: String(title || ""),
      });
    } catch (e) { console.warn("[legal-consultation-create] 운영자 알림톡 예외(무시):", e); }

    /* AI 분석 — skipAi=true면 건너뜀 */
    let aiResult: any = null;
    if (!skipAi) try {
      aiResult = await analyzeLegalConsultation({
        userCategory: category,
        userUrgency: urgency || undefined,
        reportTitle: title,
        reportContent: contentHtml,
        partyInfo: partyInfo || undefined,
        attachmentIds,
      });

      await db.update(legalConsultations).set({
        aiCategory: aiResult.category,
        aiUrgency: aiResult.urgency,
        aiSummary: aiResult.summary,
        aiRelatedLaws: aiResult.relatedLaws,
        aiLegalOpinion: aiResult.legalOpinion,
        aiLawyerSpecialty: aiResult.lawyerSpecialty,
        aiImmediateAction: aiResult.immediateAction,
        aiSuggestion: aiResult.suggestion,
        aiAnalyzedAt: new Date(),
        status: "ai_analyzed",
      } as any).where(eq(legalConsultations.id, consultationId));
    } catch (aiErr) {
      console.error("[legal-consultation-create] AI 예외:", aiErr);
    }

    /* Phase 21 R2+R3 — 워크스페이스 카드 자동 생성 + 담당자 할당 (fire-and-forget) */
    try {
      const { createWorkspaceTaskFromService, resolveAssigneeByService } = await import("../../lib/workspace-sync");
      const reporterDisplay = isAnonymous ? "익명" : (reporterName || "회원");
      const priority: "high" | "normal" | "urgent" =
        (aiResult?.urgency === "urgent" || urgency === "urgent") ? "urgent" :
        (aiResult?.urgency === "high" || urgency === "high") ? "high" : "normal";
      const taskId = await createWorkspaceTaskFromService({
        serviceKind: "legal",
        serviceId: consultationId,
        category: String(category || ""),
        title: `[법률] ${title} - ${reporterDisplay}`,
        description: aiResult?.summary ? String(aiResult.summary).slice(0, 500) : null,
        priority,
        sourceRefUrl: `/admin-siren.html#legal-${consultationId}`,
      });
      if (taskId) {
        const resolved = await resolveAssigneeByService({ serviceKind: "legal", serviceCategory: String(category || "") });
        await db.update(legalConsultations).set({
          workspaceTaskId: taskId,
          assignedTo: resolved?.uid ?? null,
        } as any).where(eq(legalConsultations.id, consultationId));
      }
    } catch (hookErr) {
      console.warn("[legal-consultation-create] 카드 생성 훅 실패:", hookErr);
    }

    /* 라운드 10 — AI 전문 분야 분석 결과 기반 변호사 자동 배정 (fire-and-forget)
     *   실제 schema: members 테이블에 expert_specialty 컬럼은 없음.
     *   변호사는 member_subtype='lawyer'로 식별, 카테고리/전문분야는 assigned_categories jsonb 배열로 운영.
     *   1차) assigned_categories::text ILIKE %specialty% 매칭
     *   2차) member_subtype='lawyer' 중 첫 활성 회원 폴백
     *   실패 시 throw 없음, console.warn만 (fire-and-forget) */
    try {
      const specialty = aiResult?.lawyerSpecialty ? String(aiResult.lawyerSpecialty).trim() : "";
      if (specialty) {
        const { sql } = await import("drizzle-orm");
        const like = "%" + specialty.replace(/[%_]/g, "") + "%";

        // 1차: 카테고리 매칭
        let matchRes: any = await db.execute(sql`
          SELECT id, name FROM members
          WHERE member_subtype = 'lawyer'
            AND status = 'active'
            AND COALESCE(assigned_categories::text, '') ILIKE ${like}
          ORDER BY id ASC
          LIMIT 1
        `);
        let rows = (matchRes?.rows ?? matchRes) as any[];

        // 2차: 폴백 (어떤 변호사든)
        if (!rows?.length) {
          matchRes = await db.execute(sql`
            SELECT id, name FROM members
            WHERE member_subtype = 'lawyer' AND status = 'active'
            ORDER BY id ASC
            LIMIT 1
          `);
          rows = (matchRes?.rows ?? matchRes) as any[];
        }

        const lawyer = rows?.[0];
        if (lawyer) {
          await db.update(legalConsultations).set({
            assignedLawyerId: Number(lawyer.id),
            assignedLawyerName: lawyer.name || null,
            assignedAt: new Date(),
          } as any).where(eq(legalConsultations.id, consultationId));

          // 신청자에게 변호사 배정 알림 (fire-and-forget)
          try {
            const { dispatch } = await import("../../lib/notify-dispatcher");
            const { NotifyEvent } = await import("../../lib/notify-events");
            dispatch({
              event: NotifyEvent.LEGAL_ASSIGNED,
              target: { type: "member", id: user.uid },
              params: {
                title: "담당 변호사가 배정되었습니다",
                message: `${lawyer.name || "변호사"}님이 법률 상담 담당으로 배정되었습니다.`,
                link: `/mypage.html#support`,
                category: "legal",
                severity: "info",
                refTable: "legal_consultations",
                refId: consultationId,
              },
            });
          } catch (notifyErr) {
            console.warn("[legal-consultation-create] LEGAL_ASSIGNED 알림 실패:", notifyErr);
          }
        }
      }
    } catch (assignErr) {
      console.warn("[legal-consultation-create] AI 변호사 자동 배정 실패:", assignErr);
    }

    /* (운영자 알림은 접수 성공 직후 항상 발송하도록 위로 이동 — 2026-07-01) */

   // netlify/functions/legal-consultation-create.ts — 감사 로그 + return 블록 교체
    /* M-17: 후원자 검증 */
    const donorCheck = await hasAnyCompletedDonation(user.uid);

    try {
      await logUserAction(req, user.uid, (me as any)?.name || "unknown", "legal_consultation_create", {
        target: consultationNo,
        detail: {
          category,
          urgency,
          isAnonymous,
          isDonor: donorCheck.isDonor,
          donationCount: donorCheck.donationCount,
        },
        success: true,
      });
    } catch (_) {}

    /* M-17: AI 결과는 DB에 항상 저장, 응답은 후원자만 */
    return created({
      consultationId,
      consultationNo,
      isDonor: donorCheck.isDonor,
      skipAi,
      ai: (aiResult && donorCheck.isDonor && !skipAi) ? {
        category: aiResult.category,
        urgency: aiResult.urgency,
        summary: aiResult.summary,
        relatedLaws: aiResult.relatedLaws,
        legalOpinion: aiResult.legalOpinion,
        lawyerSpecialty: aiResult.lawyerSpecialty,
        immediateAction: aiResult.immediateAction,
        suggestion: aiResult.suggestion,
        fromAi: aiResult.fromAi,
      } : null,
      premiumNotice: !donorCheck.isDonor ? getNonDonorPremiumNotice("legal") : null,
    }, "법률 상담 신청이 접수되었습니다");
  } catch (err) {
    console.error("[legal-consultation-create]", err);
    return serverError("처리 중 오류가 발생했습니다", err);
  }
};
export const config = { path: "/api/legal-consultation-create" };