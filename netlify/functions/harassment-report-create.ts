// netlify/functions/harassment-report-create.ts
// ★ Phase M-6: 악성민원 신고 생성 + AI 분석

import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { harassmentReports, members } from "../../db/schema";
// netlify/functions/harassment-report-create.ts — import 영역 교체
import { authenticateUser, requireActiveUser } from "../../lib/auth";
import { analyzeHarassmentReport } from "../../lib/ai-harassment";
import { notifyAllOperators } from "../../lib/notify";
import { hasAnyCompletedDonation, getNonDonorPremiumNotice } from "../../lib/donor-check";
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

  /* 인증 + 차단 검증 (5순위 #1) */
  const _r = await requireActiveUser(req);
  if (!_r.ok) return (_r as { ok: false; res: Response }).res;
  const user = _r.user;

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const category = VALID_CATEGORIES.includes(body.category) ? body.category : "parent";
    const frequency = VALID_FREQUENCIES.includes(body.frequency) ? body.frequency : null;
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

    /* AI 분석 (격리) — skipAi=true면 건너뜀 */
    let aiResult: any = null;
    if (!skipAi) try {
      aiResult = await analyzeHarassmentReport({
        userCategory: category,
        reportTitle: title,
        reportContent: contentHtml,
        frequency: frequency || undefined,
        attachmentIds,
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

    /* ★ Phase 21 R2+R3 — 워크스페이스 카드 자동 생성 + 담당자 할당 (fire-and-forget) */
    try {
      const { createWorkspaceTaskFromService, resolveAssigneeByService } = await import("../../lib/workspace-sync");
      const reporterDisplay = isAnonymous ? "익명" : (reporterName || "회원");
      const priority: "high" | "normal" =
        (aiResult?.severity === "high" || aiResult?.severity === "critical") ? "high" : "normal";
      const taskId = await createWorkspaceTaskFromService({
        serviceKind: "harassment",
        serviceId: reportId,
        category: String(category || ""),
        title: `[괴롭힘] ${title} - ${reporterDisplay}`,
        description: aiResult?.summary ? String(aiResult.summary).slice(0, 500) : null,
        priority,
        sourceRefUrl: `/admin-siren.html#harassment-${reportId}`,
      });
      if (taskId) {
        const resolved = await resolveAssigneeByService({ serviceKind: "harassment", serviceCategory: String(category || "") });
        await db.update(harassmentReports).set({
          workspaceTaskId: taskId,
          assignedTo: resolved?.uid ?? null,
        } as any).where(eq(harassmentReports.id, reportId));
      }
    } catch (hookErr) {
      console.warn("[harassment-report-create] 카드 생성 훅 실패:", hookErr);
    }

    /* ★ R41 Q2-009: AI 건너뛴(skipAi) 신고는 정식접수 결정 단계가 없어 운영자 통지 누락 → 생성 시점 1회 발송 */
    if (skipAi) {
      try {
        await notifyAllOperators({
          category: "support",
          severity: "info",
          title: `📢 악성민원 신고 접수(직접 검토 요청): ${reportNo}`,
          message: title,
          link: `/admin.html#harassment-reports`,
          refTable: "harassment_reports",
          refId: reportId,
        }, { category: "harassment" });
      } catch (e) {
        console.warn("[harassment-report-create] skipAi 운영자 알림 실패:", e);
      }
    }

    // netlify/functions/harassment-report-create.ts — 감사 로그 + return 블록 교체
    /* ★ M-17: 후원자 검증 */
    const donorCheck = await hasAnyCompletedDonation(user.uid);

    /* 감사 로그 */
    try {
      await logUserAction(req, user.uid, (me as any)?.name || "unknown", "harassment_report_create", {
        target: reportNo,
        detail: {
          category,
          isAnonymous,
          isDonor: donorCheck.isDonor,
          donationCount: donorCheck.donationCount,
        },
        success: true,
      });
    } catch (_) {}

    /* ★ M-17: AI 결과는 DB에 항상 저장, 응답은 후원자만 */
    return created({
      reportId,
      reportNo,
      isDonor: donorCheck.isDonor,
      skipAi,
      ai: (aiResult && donorCheck.isDonor && !skipAi) ? {
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
      premiumNotice: !donorCheck.isDonor ? getNonDonorPremiumNotice("harassment") : null,
    }, "신고가 접수되었습니다");
  } catch (err) {
    console.error("[harassment-report-create]", err);
    return serverError("신고 처리 중 오류가 발생했습니다", err);
  }
};