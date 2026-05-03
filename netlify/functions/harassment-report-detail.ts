// netlify/functions/harassment-report-detail.ts
// ★ Phase M-6: 본인 신고 상세 조회

import type { Context } from "@netlify/functions";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../db";
import { harassmentReports, blobUploads } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { ok, badRequest, unauthorized, notFound, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/harassment-report-detail" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!Number.isFinite(id)) return badRequest("id 필요");

    const [row] = await db.select().from(harassmentReports)
      .where(and(eq(harassmentReports.id, id), eq(harassmentReports.memberId, user.uid)))
      .limit(1);

    if (!row) return notFound("신고를 찾을 수 없습니다");

    const r: any = row;
    let attachments: any[] = [];
    if (r.attachmentIds) {
      try {
        const ids = JSON.parse(r.attachmentIds);
        if (Array.isArray(ids) && ids.length) {
          const files = await db.select().from(blobUploads).where(inArray(blobUploads.id, ids));
          attachments = files.map((f: any) => ({
            id: f.id, originalName: f.originalName, mimeType: f.mimeType,
            sizeBytes: f.sizeBytes, url: `/api/blob-image?id=${f.id}`,
          }));
        }
      } catch (_) {}
    }

    return ok({
      report: {
        id: r.id, reportNo: r.reportNo, title: r.title,
        category: r.category, frequency: r.frequency, occurredAt: r.occurredAt,
        contentHtml: r.contentHtml, isAnonymous: r.isAnonymous,
        aiCategory: r.aiCategory, aiSeverity: r.aiSeverity, aiSummary: r.aiSummary,
        aiImmediateAction: r.aiImmediateAction,
        aiLegalReviewNeeded: r.aiLegalReviewNeeded, aiLegalReason: r.aiLegalReason,
        aiPsychSupportNeeded: r.aiPsychSupportNeeded, aiSuggestion: r.aiSuggestion,
        sirenReportRequested: r.sirenReportRequested,
        status: r.status, adminResponse: r.adminResponse, respondedAt: r.respondedAt,
        createdAt: r.createdAt,
        attachments,
      },
    });
  } catch (e: any) {
    console.error("[harassment-report-detail]", e);
    return serverError("조회 실패", e);
  }
};