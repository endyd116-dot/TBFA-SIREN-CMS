// netlify/functions/harassment-report-create.ts
// ★ Phase M-6: 악성민원 신고 생성 + AI 분석

import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { harassmentReports, members } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { analyzeHarassmentReport } from "../../lib/ai-harassment";
import {
  created, badRequest, unauthorized, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/harassment-report-create" };

function genReportNo(): string {
  const y = new Date().getFullYear();
  const r = String(Math.floor(Math.random() * 9000) + 1000);
  return `H-${y}-${r}`;
}

const VALID_CATEGORIES = ["parent", "student", "admin", "colleague", "other"];
const VALID_FREQUENCIES = ["once", "recurring", "ongoing"];

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const category = VALID_CATEGORIES.includes(body.category) ? body.category : "parent";
    const frequency = VALID_FREQUENCIES.includes(body.frequency) ? body.frequency : null;
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

    /* 신원 정보 */
    const [me] = await db.select().from(members).where(eq(members.id, user.uid)).limit(1);
    const reporterName = isAnonymous ? null : (me as any)?.name || null;
    const reporterPhone = isAnonymous ? null : (me as any)?.phone || null;
    const reporterEmail = isAnonymous ? null : (me as any)?.email || null;

    const reportNo = genReportNo();
    const insertData: any = {
      reportNo,
      memberId: user.uid,
      category,
      frequency,
      occurredAt,
      title,
      contentHtml,
      attachmentIds: attachmentIds.length ? JSON.stringify(attachmentIds) : null,
      isAnonymous,
      reporterName,
      reporterPhone,
      reporterEmail,
      status: "submitted",
    };

    const [record] = await db.insert(harassmentReports).values(insertData).returning();
    const reportId = (record as any).id;

    /* AI 분석 (격리) */
    let aiResult: any = null;
    try {
      aiResult = await analyzeHarassmentReport({
        userCategory: category,
        reportTitle: title,
        reportContent: contentHtml,
        frequency: frequency || undefined,
      });

      await db.update(harassmentReports).set({
        aiCategory: aiResult.category,
        aiSeverity: aiResult.severity,
        aiSummary: aiResult.summary,
        aiImmediateAction: aiResult.immediateAction,
        aiLegalReviewNeeded: aiResult.legalReviewNeeded,
        aiLegalReason: aiResult.legalReason,
        aiPsychSupportNeeded: aiResult.psychSupportNeeded,
        aiSuggestion: aiResult.suggestion,
        aiAnalyzedAt: new Date(),
        status: "ai_analyzed",
      } as any).where(eq(harassmentReports.id, reportId));
    } catch (aiErr) {
      console.error("[harassment-report-create] AI 예외:", aiErr);
    }

    /* 감사 로그 */
    try {
      await logUserAction(req, user.uid, (me as any)?.name || "unknown", "harassment_report_create", {
        target: reportNo,
        detail: { category, isAnonymous },
        success: true,
      });
    } catch (_) {}

    return created({
      reportId,
      reportNo,
      ai: aiResult ? {
        category: aiResult.category,
        severity: aiResult.severity,
        summary: aiResult.summary,
        immediateAction: aiResult.immediateAction,
        legalReviewNeeded: aiResult.legalReviewNeeded,
        legalReason: aiResult.legalReason,
        psychSupportNeeded: aiResult.psychSupportNeeded,
        suggestion: aiResult.suggestion,
        fromAi: aiResult.fromAi,
      } : null,
    }, "신고가 접수되었습니다");
  } catch (err) {
    console.error("[harassment-report-create]", err);
    return serverError("신고 처리 중 오류가 발생했습니다", err);
  }
};