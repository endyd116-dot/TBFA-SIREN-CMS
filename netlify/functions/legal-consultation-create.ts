// netlify/functions/legal-consultation-create.ts
// ★ Phase M-7: 법률 상담 신청 + AI 1차 자문

import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { legalConsultations, members } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { analyzeLegalConsultation } from "../../lib/ai-legal";
import {
  created, badRequest, unauthorized, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/legal-consultation-create" };

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

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const category = VALID_CATEGORIES.includes(body.category) ? body.category : "school_dispute";
    const urgency = VALID_URGENCY.includes(body.urgency) ? body.urgency : null;
    const partyInfo = String(body.partyInfo || "").trim().slice(0, 200) || null;
    const title = String(body.title || "").trim().slice(0, 200);
    const contentHtml = String(body.contentHtml || "").trim();
    const isAnonymous = !!body.isAnonymous;
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

    /* AI 분석 */
    let aiResult: any = null;
    try {
      aiResult = await analyzeLegalConsultation({
        userCategory: category,
        userUrgency: urgency || undefined,
        reportTitle: title,
        reportContent: contentHtml,
        partyInfo: partyInfo || undefined,
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

    try {
      await logUserAction(req, user.uid, (me as any)?.name || "unknown", "legal_consultation_create", {
        target: consultationNo,
        detail: { category, urgency, isAnonymous },
        success: true,
      });
    } catch (_) {}

    return created({
      consultationId,
      consultationNo,
      ai: aiResult ? {
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
    }, "법률 상담 신청이 접수되었습니다");
  } catch (err) {
    console.error("[legal-consultation-create]", err);
    return serverError("처리 중 오류가 발생했습니다", err);
  }
};