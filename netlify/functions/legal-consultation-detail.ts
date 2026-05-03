// netlify/functions/legal-consultation-detail.ts
// ★ Phase M-7: 본인 법률 상담 상세

import type { Context } from "@netlify/functions";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../db";
import { legalConsultations, blobUploads } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { ok, badRequest, unauthorized, notFound, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/legal-consultation-detail" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!Number.isFinite(id)) return badRequest("id 필요");

    const [row] = await db.select().from(legalConsultations)
      .where(and(eq(legalConsultations.id, id), eq(legalConsultations.memberId, user.uid)))
      .limit(1);

    if (!row) return notFound("상담 신청을 찾을 수 없습니다");

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
      consultation: {
        id: r.id, consultationNo: r.consultationNo, title: r.title,
        category: r.category, urgency: r.urgency, occurredAt: r.occurredAt,
        partyInfo: r.partyInfo, contentHtml: r.contentHtml, isAnonymous: r.isAnonymous,
        aiCategory: r.aiCategory, aiUrgency: r.aiUrgency, aiSummary: r.aiSummary,
        aiRelatedLaws: r.aiRelatedLaws, aiLegalOpinion: r.aiLegalOpinion,
        aiLawyerSpecialty: r.aiLawyerSpecialty, aiImmediateAction: r.aiImmediateAction,
        aiSuggestion: r.aiSuggestion,
        sirenReportRequested: r.sirenReportRequested,
        assignedLawyerName: r.assignedLawyerName, assignedAt: r.assignedAt,
        status: r.status, adminResponse: r.adminResponse, respondedAt: r.respondedAt,
        createdAt: r.createdAt,
        attachments,
      },
    });
  } catch (e: any) {
    console.error("[legal-consultation-detail]", e);
    return serverError("조회 실패", e);
  }
};