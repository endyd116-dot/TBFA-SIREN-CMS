// netlify/functions/incident-report-detail.ts
// ★ M-5: 본인 제보 상세 조회

import type { Context } from "@netlify/functions";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../db";
import { incidentReports, incidents, blobUploads } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { ok, badRequest, unauthorized, notFound, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/incident-report-detail" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!Number.isFinite(id)) return badRequest("id 필요");

    const [row] = await db.select({
      report: incidentReports,
      incidentSlug: incidents.slug,
      incidentTitle: incidents.title,
    })
      .from(incidentReports)
      .leftJoin(incidents, eq(incidentReports.incidentId, incidents.id))
      .where(and(eq(incidentReports.id, id), eq(incidentReports.memberId, user.uid)))
      .limit(1);

    if (!row) return notFound("제보를 찾을 수 없습니다");

    /* 첨부파일 조회 */
    const r: any = row.report;
    let attachments: any[] = [];
    if (r.attachmentIds) {
      try {
        const ids = JSON.parse(r.attachmentIds);
        if (Array.isArray(ids) && ids.length) {
          const files = await db.select().from(blobUploads).where(inArray(blobUploads.id, ids));
          attachments = files.map((f: any) => ({
            id: f.id,
            originalName: f.originalName,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            url: `/api/blob-image?id=${f.id}`,
          }));
        }
      } catch (_) {}
    }

    return ok({
      report: {
        id: r.id,
        reportNo: r.reportNo,
        title: r.title,
        contentHtml: r.contentHtml,
        isAnonymous: r.isAnonymous,
        aiSeverity: r.aiSeverity,
        aiSummary: r.aiSummary,
        aiSuggestion: r.aiSuggestion,
        sirenReportRequested: r.sirenReportRequested,
        status: r.status,
        adminResponse: r.adminResponse,
        respondedAt: r.respondedAt,
        createdAt: r.createdAt,
        incidentSlug: row.incidentSlug,
        incidentTitle: row.incidentTitle,
        attachments,
      },
    });
  } catch (e: any) {
    console.error("[incident-report-detail]", e);
    return serverError("조회 실패", e);
  }
};