// netlify/functions/admin-ai-reply-v2.ts
// ★ M-10: 사이렌 관리 통합 AI 답변 초안 (사건/악성/법률/자유게시판)
// ★ 2026-05 패치: type-only import 의존성 완전 제거 (빌드 안정성 ↑)

import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  incidentReports, harassmentReports, legalConsultations, boardPosts,
  members,
} from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { generateUniversalReplyDraft } from "../../lib/ai-reply";
import {
  ok, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/admin/ai/reply-draft-v2" };

const VALID_KINDS = ["incident", "harassment", "legal", "board"] as const;

function htmlToText(html: string): string {
  return String(html || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ").trim();
}

export default async (req: Request, _ctx: Context) => {
  console.log("[admin-ai-reply-v2] called:", req.method, req.url);

  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") {
    console.warn("[admin-ai-reply-v2] non-POST:", req.method);
    return methodNotAllowed("POST 메서드만 허용됩니다");
  }

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const kind = String(body.kind || "");
    const id = Number(body.id);

    if (!VALID_KINDS.includes(kind as any)) {
      return badRequest("kind 유효하지 않음 (incident|harassment|legal|board)");
    }
    if (!Number.isFinite(id)) return badRequest("id 유효하지 않음");

    let applicantName = "회원";
    let title = "";
    let contentText = "";
    let aiSeverity: string | undefined;
    let aiSummary: string | undefined;
    let aiSuggestion: string | undefined;
    let currentStatus: string | undefined;

    if (kind === "incident") {
      const [r] = await db.select().from(incidentReports).where(eq(incidentReports.id, id)).limit(1);
      if (!r) return notFound("제보를 찾을 수 없습니다");

      const [m] = (r as any).memberId
        ? await db.select({ name: members.name }).from(members).where(eq(members.id, (r as any).memberId)).limit(1)
        : [null];

      applicantName = (r as any).isAnonymous ? "제보자" : ((m as any)?.name || "회원");
      title = (r as any).title || "";
      contentText = htmlToText((r as any).contentHtml || "");
      aiSeverity = (r as any).aiSeverity;
      aiSummary = (r as any).aiSummary;
      aiSuggestion = (r as any).aiSuggestion;
      currentStatus = (r as any).status;
    } else if (kind === "harassment") {
      const [r] = await db.select().from(harassmentReports).where(eq(harassmentReports.id, id)).limit(1);
      if (!r) return notFound("신고를 찾을 수 없습니다");

      const [m] = (r as any).memberId
        ? await db.select({ name: members.name }).from(members).where(eq(members.id, (r as any).memberId)).limit(1)
        : [null];

      applicantName = (r as any).isAnonymous ? "신고자" : ((m as any)?.name || "회원");
      title = (r as any).title || "";
      contentText = htmlToText((r as any).contentHtml || "");
      aiSeverity = (r as any).aiSeverity;
      aiSummary = (r as any).aiSummary;
      aiSuggestion = (r as any).aiSuggestion;
      currentStatus = (r as any).status;
    } else if (kind === "legal") {
      const [r] = await db.select().from(legalConsultations).where(eq(legalConsultations.id, id)).limit(1);
      if (!r) return notFound("상담을 찾을 수 없습니다");

      const [m] = (r as any).memberId
        ? await db.select({ name: members.name }).from(members).where(eq(members.id, (r as any).memberId)).limit(1)
        : [null];

      applicantName = (r as any).isAnonymous ? "신청자" : ((m as any)?.name || "회원");
      title = (r as any).title || "";
      contentText = htmlToText((r as any).contentHtml || "");
      aiSeverity = (r as any).aiUrgency;
      aiSummary = (r as any).aiSummary;
      aiSuggestion = (r as any).aiSuggestion;
      currentStatus = (r as any).status;
    } else if (kind === "board") {
      const [r] = await db.select().from(boardPosts).where(eq(boardPosts.id, id)).limit(1);
      if (!r) return notFound("게시글을 찾을 수 없습니다");

      applicantName = (r as any).isAnonymous ? "작성자" : ((r as any).authorName || "회원");
      title = (r as any).title || "";
      contentText = htmlToText((r as any).contentHtml || "");
    }

    if (!contentText || contentText.length < 5) {
      return badRequest("본문이 너무 짧아 AI 분석을 진행할 수 없습니다");
    }

    const result = await generateUniversalReplyDraft({
      category: kind as any,
      applicantName,
      title,
      contentText,
      aiSeverity,
      aiSummary,
      aiSuggestion,
      currentStatus,
    });

    if (!result.ok) {
      return serverError("AI 답변 초안 생성 실패", result.error);
    }

    return ok({ draft: result.draft }, "답변 초안이 생성되었습니다");
  } catch (e: any) {
    console.error("[admin-ai-reply-v2]", e);
    return serverError("AI 호출 중 오류", e?.message);
  }
};