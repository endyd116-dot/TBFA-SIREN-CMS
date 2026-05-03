// netlify/functions/harassment-reports-mine.ts
// ★ Phase M-6: 본인 신고 목록 조회

import type { Context } from "@netlify/functions";
import { eq, desc } from "drizzle-orm";
import { db } from "../../db";
import { harassmentReports } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { ok, unauthorized, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/harassment-reports/mine" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    const list = await db.select({
      id: harassmentReports.id,
      reportNo: harassmentReports.reportNo,
      title: harassmentReports.title,
      category: harassmentReports.category,
      isAnonymous: harassmentReports.isAnonymous,
      aiSeverity: harassmentReports.aiSeverity,
      aiSummary: harassmentReports.aiSummary,
      aiSuggestion: harassmentReports.aiSuggestion,
      aiLegalReviewNeeded: harassmentReports.aiLegalReviewNeeded,
      aiPsychSupportNeeded: harassmentReports.aiPsychSupportNeeded,
      sirenReportRequested: harassmentReports.sirenReportRequested,
      status: harassmentReports.status,
      adminResponse: harassmentReports.adminResponse,
      respondedAt: harassmentReports.respondedAt,
      createdAt: harassmentReports.createdAt,
    })
      .from(harassmentReports)
      .where(eq(harassmentReports.memberId, user.uid))
      .orderBy(desc(harassmentReports.createdAt));

    return ok({ list });
  } catch (e: any) {
    console.error("[harassment-reports-mine]", e);
    return serverError("조회 실패", e);
  }
};