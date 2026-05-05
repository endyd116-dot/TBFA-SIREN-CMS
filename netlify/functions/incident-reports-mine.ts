// netlify/functions/incident-reports-mine.ts
// ★ M-5: 본인이 작성한 사건 제보 목록 조회 (마이페이지용)
// ★ 2026-05 응급 패치: 파일에 auth.js 코드가 잘못 들어가 있던 것 완전 제거

import type { Context } from "@netlify/functions";
import { eq, desc } from "drizzle-orm";
import { db } from "../../db";
import { incidentReports, incidents } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import {
  ok, unauthorized, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/incident-reports/mine" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    const list = await db
      .select({
        id: incidentReports.id,
        reportNo: incidentReports.reportNo,
        title: incidentReports.title,
        isAnonymous: incidentReports.isAnonymous,
        aiSeverity: incidentReports.aiSeverity,
        aiSummary: incidentReports.aiSummary,
        aiSuggestion: incidentReports.aiSuggestion,
        sirenReportRequested: incidentReports.sirenReportRequested,
        status: incidentReports.status,
        adminResponse: incidentReports.adminResponse,
        respondedAt: incidentReports.respondedAt,
        createdAt: incidentReports.createdAt,
        incidentSlug: incidents.slug,
        incidentTitle: incidents.title,
      })
      .from(incidentReports)
      .leftJoin(incidents, eq(incidentReports.incidentId, incidents.id))
      .where(eq(incidentReports.memberId, user.uid))
      .orderBy(desc(incidentReports.createdAt));

    return ok({ list });
  } catch (e: any) {
    console.error("[incident-reports-mine]", e);
    return serverError("조회 실패", e?.message);
  }
};