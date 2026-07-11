// netlify/functions/public-activity-reports.ts
// Phase M-19-3 + C안: 발행된 활동보고서 공개 API
//
// GET /api/public/activity-reports                — 발행된 보고서 목록 (최신순)
// GET /api/public/activity-reports?year=2025      — 연도 필터
// GET /api/public/activity-reports?id=N           — 단건 + PDF 링크 + 조회수+1

import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../../db";
import { activityPosts, blobUploads } from "../../db/schema";
import {
  ok, badRequest, notFound, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const idParam = url.searchParams.get("id");

    /* ── 단건 상세 ── */
    if (idParam) {
      const id = Number(idParam);
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const [post] = await db
        .select({
          id: activityPosts.id,
          slug: activityPosts.slug,
          title: activityPosts.title,
          year: activityPosts.year,
          month: activityPosts.month,
          summary: activityPosts.summary,
          contentHtml: activityPosts.contentHtml,
          attachmentIds: activityPosts.attachmentIds,
          publishedAt: activityPosts.publishedAt,
          views: activityPosts.views,
        })
        .from(activityPosts)
        .where(and(
          eq(activityPosts.id, id),
          eq(activityPosts.category, "report"),
          eq(activityPosts.isPublished, true),
        ))
        .limit(1);

      if (!post) return notFound("발행된 보고서를 찾을 수 없습니다");

      /* PDF blob 정보 추출 */
      let pdfBlobId: number | null = null;
      let pdfSizeBytes: number | null = null;
      try {
        const ids = typeof post.attachmentIds === "string"
          ? JSON.parse(post.attachmentIds)
          : post.attachmentIds;
        if (Array.isArray(ids) && ids.length > 0) {
          const blobRows = await db
            .select({
              id: blobUploads.id,
              mimeType: blobUploads.mimeType,
              context: blobUploads.context,
              sizeBytes: blobUploads.sizeBytes,
            })
            .from(blobUploads)
            .where(sql`${blobUploads.id} = ANY(${ids})`);
          const pdfBlob = blobRows.find((b: any) =>
            b.context === "activity_report_pdf" || b.mimeType === "application/pdf"
          );
          if (pdfBlob) {
            pdfBlobId = pdfBlob.id;
            pdfSizeBytes = pdfBlob.sizeBytes;
          }
        }
      } catch (_) {}

      /* 조회수 +1 (best-effort, 실패 무시) */
      try {
        await db.update(activityPosts)
          .set({ views: sql`${activityPosts.views} + 1` } as any)
          .where(eq(activityPosts.id, id));
      } catch (_) {}

      return ok({
        post: {
          id: post.id,
          slug: post.slug,
          title: post.title,
          year: post.year,
          month: post.month,
          summary: post.summary,
          contentHtml: post.contentHtml,
          publishedAt: post.publishedAt,
          views: (post.views || 0) + 1,
        },
        pdf: pdfBlobId ? {
          blobId: pdfBlobId,
          sizeBytes: pdfSizeBytes,
          downloadUrl: `/api/blob-image?id=${pdfBlobId}&download=1`,
        } : null,
      });
    }

    /* ── 목록 (발행된 것만) ── */
    const limit = Math.min(50, Math.max(5, Number(url.searchParams.get("limit") || 20)));
    /* Q4-029: page 파라미터 + offset — 보고서 50개 초과 시 아카이브 접근 가능 */
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const offset = (page - 1) * limit;
    const yearParam = url.searchParams.get("year");

    const conds: any[] = [
      eq(activityPosts.category, "report"),
      eq(activityPosts.isPublished, true),
    ];
    if (yearParam) {
      const yn = Number(yearParam);
      if (Number.isFinite(yn)) conds.push(eq(activityPosts.year, yn));
    }

    const list = await db
      .select({
        id: activityPosts.id,
        slug: activityPosts.slug,
        title: activityPosts.title,
        year: activityPosts.year,
        month: activityPosts.month,
        summary: activityPosts.summary,
        attachmentIds: activityPosts.attachmentIds,
        publishedAt: activityPosts.publishedAt,
        views: activityPosts.views,
        isPinned: activityPosts.isPinned,
      })
      .from(activityPosts)
      .where(and(...conds))
      .orderBy(
        desc(activityPosts.isPinned),
        desc(activityPosts.year),
        desc(activityPosts.month),
        desc(activityPosts.publishedAt),
      )
      .limit(limit)
      .offset(offset);

    /* 전체 건수 (페이지네이션 메타) */
    let total = 0;
    try {
      const cnt: any = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(activityPosts)
        .where(and(...conds));
      total = Number((cnt?.[0] ?? {}).n ?? 0);
    } catch (_) { total = 0; }

    /* 각 보고서마다 PDF blob 정보 추출 (단일 쿼리로 일괄 조회) */
    const allBlobIds: number[] = [];
    const postBlobMap: Record<number, number | null> = {};

    for (const p of list) {
      try {
        const ids = typeof p.attachmentIds === "string"
          ? JSON.parse(p.attachmentIds)
          : p.attachmentIds;
        if (Array.isArray(ids) && ids.length > 0) {
          postBlobMap[p.id] = ids[0];
          allBlobIds.push(...ids.filter((x: any) => Number.isInteger(x)));
        } else {
          postBlobMap[p.id] = null;
        }
      } catch (_) {
        postBlobMap[p.id] = null;
      }
    }

    /* PDF blob의 size만 일괄 조회 */
    const blobSizeMap: Record<number, number> = {};
    if (allBlobIds.length > 0) {
      try {
        const sizes = await db
          .select({ id: blobUploads.id, sizeBytes: blobUploads.sizeBytes })
          .from(blobUploads)
          .where(sql`${blobUploads.id} = ANY(${allBlobIds})`);
        for (const s of sizes as any[]) {
          blobSizeMap[s.id] = s.sizeBytes;
        }
      } catch (_) {}
    }

    const enriched = list.map((p: any) => {
      const pdfBlobId = postBlobMap[p.id];
      const sizeBytes = pdfBlobId ? (blobSizeMap[pdfBlobId] || null) : null;
      return {
        id: p.id,
        slug: p.slug,
        title: p.title,
        year: p.year,
        month: p.month,
        summary: p.summary,
        publishedAt: p.publishedAt,
        views: p.views,
        isPinned: p.isPinned,
        pdfBlobId,
        pdfSizeBytes: sizeBytes,
        pdfDownloadUrl: pdfBlobId ? `/api/blob-image?id=${pdfBlobId}&download=1` : null,
      };
    });

    return ok({
      list: enriched,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err: any) {
    console.error("[public-activity-reports]", err);
    return serverError("보고서 조회 중 오류", err?.message);
  }
};

export const config = { path: "/api/public/activity-reports" };