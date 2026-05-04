// netlify/functions/incident-report-create.ts
// ★ M-5: 사건 제보 생성 + AI 자동 분석
// - 로그인 필수 (A안)
// - DB 저장 후 Gemini 자동 분석 → AI 결과 응답
// - 사이렌 정식 접수 여부는 후속 confirm API에서 결정 (B안)
// netlify/functions/incident-report-create.ts — import 영역 (1~10행 부근) 통째 교체
import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { incidents, incidentReports, members } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { analyzeIncidentReport } from "../../lib/ai-incident";
import { hasAnyCompletedDonation, getNonDonorPremiumNotice } from "../../lib/donor-check";
import {
  created, badRequest, unauthorized, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/incident-report-create" };

function generateReportNo(): string {
  const now = new Date();
  const year = now.getFullYear();
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `R-${year}-${rand}`;
  
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  /* A안: 로그인 필수 */
  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const incidentSlug = String(body.incidentSlug || "").trim();
    const title = String(body.title || "").trim().slice(0, 200);
    const contentHtml = String(body.contentHtml || "").trim();
    const isAnonymous = !!body.isAnonymous;
    const attachmentIds = Array.isArray(body.attachmentIds)
      ? body.attachmentIds.filter((x: any) => Number.isFinite(Number(x))).map(Number)
      : [];

    if (!title) return badRequest("제목은 필수입니다");
    if (!contentHtml || contentHtml.length < 10) return badRequest("내용을 10자 이상 입력해주세요");
    if (contentHtml.length > 100000) return badRequest("내용이 너무 깁니다 (최대 10만자)");

    /* 사건 연결 (선택) */
    let incidentId: number | null = null;
    let incidentTitle: string | undefined = undefined;
    if (incidentSlug) {
      const [inc] = await db.select().from(incidents).where(eq(incidents.slug, incidentSlug)).limit(1);
      if (inc) {
        incidentId = (inc as any).id;
        incidentTitle = (inc as any).title;
      }
    }

    /* 신원 정보 (익명 아닐 때만) */
    const [me] = await db.select().from(members).where(eq(members.id, user.uid)).limit(1);
    const reporterName = isAnonymous ? null : (me as any)?.name || null;
    const reporterPhone = isAnonymous ? null : (me as any)?.phone || null;
    const reporterEmail = isAnonymous ? null : (me as any)?.email || null;

    /* DB INSERT */
    const reportNo = generateReportNo();
    const insertData: any = {
      reportNo,
      incidentId,
      memberId: user.uid,
      title,
      contentHtml,
      attachmentIds: attachmentIds.length ? JSON.stringify(attachmentIds) : null,
      isAnonymous,
      reporterName,
      reporterPhone,
      reporterEmail,
      status: "submitted",
    };

    const [record] = await db.insert(incidentReports).values(insertData).returning();
    const reportId = (record as any).id;

    /* AI 분석 (try-catch 격리) */
    let aiResult: any = null;
    try {
      aiResult = await analyzeIncidentReport({
        incidentTitle,
        reportTitle: title,
        reportContent: contentHtml,
      });

      await db.update(incidentReports).set({
        aiSeverity: aiResult.severity,
        aiSummary: aiResult.summary,
        aiSuggestion: aiResult.suggestion,
        aiAnalyzedAt: new Date(),
        status: "ai_analyzed",
      } as any).where(eq(incidentReports.id, reportId));
    } catch (aiErr) {
      console.error("[incident-report-create] AI 분석 예외:", aiErr);
    }

    /* 감사 로그 */
// netlify/functions/incident-report-create.ts — 감사 로그 + return 블록 교체
    /* ★ M-17: 후원자 검증 — AI 결과 응답 제한 */
    const donorCheck = await hasAnyCompletedDonation(user.uid);

    /* 감사 로그 */
    try {
      await logUserAction(req, user.uid, (me as any)?.name || "unknown", "incident_report_create", {
        target: reportNo,
        detail: {
          incidentSlug,
          isAnonymous,
          hasAi: !!aiResult,
          isDonor: donorCheck.isDonor,
          donationCount: donorCheck.donationCount,
        },
        success: true,
      });
    } catch (_) {}

    /* ★ M-17: AI 결과는 DB에는 항상 저장하되, 응답에서는 후원자에게만 제공 */
    return created({
      reportId,
      reportNo,
      isDonor: donorCheck.isDonor,
      ai: (aiResult && donorCheck.isDonor) ? {
        severity: aiResult.severity,
        summary: aiResult.summary,
        suggestion: aiResult.suggestion,
        fromAi: aiResult.fromAi,
      } : null,
      premiumNotice: !donorCheck.isDonor ? getNonDonorPremiumNotice("incident") : null,
    }, "제보가 접수되었습니다");
  } catch (err) {
    console.error("[incident-report-create]", err);
    return serverError("제보 처리 중 오류가 발생했습니다", err);
  }
};