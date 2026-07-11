// netlify/functions/admin-activity-report-ai.ts
// Phase M-19-3 + C안: AI 활동보고서 생성/조회/수정/삭제 어드민 API
//
// POST /api/admin/activity-report-ai
//   body: {
//     period: { type, year?, quarter?, half?, startDate?, endDate?, label? },
//     saveAsPost?: boolean,
//     generatePdf?: boolean,
//     postTitle?: string,
//     postSlug?: string,
//   }
//
// GET /api/admin/activity-report-ai?list=1                — 저장된 보고서 목록 (C안 신규)
// GET /api/admin/activity-report-ai?postId=N              — 단건 HTML 본문
// GET /api/admin/activity-report-ai?postId=N&pdf=1        — PDF 다운로드 리다이렉트
//
// PATCH /api/admin/activity-report-ai                     — 제목/발행/고정 수정 (C안 신규)
//   body: { id, title?, isPublished?, isPinned? }
//
// DELETE /api/admin/activity-report-ai?id=N               — 보고서 삭제 (C안 신규)
//
// 권한: super_admin 또는 'all' 카테고리 담당자

import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../../db";
import { activityPosts, blobUploads, receiptSettings } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";
import {
  collectReportData,
  periodForQuarter,
  periodForHalf,
  periodForYear,
  periodForCustom,
  type ReportPeriod,
} from "../../lib/report-data-collector";
import { generateActivityReport } from "../../lib/ai-report-generator";
import { buildActivityReportPdf } from "../../lib/pdf-activity-report";
import { uploadToR2 } from "../../lib/r2-server";
import crypto from "crypto";

/* ───────── 권한 체크 ───────── */
function canGenerate(adminMember: any): boolean {
  if (!adminMember) return false;
  if (adminMember.role === "super_admin") return true;
  const cats: string[] = Array.isArray(adminMember.assignedCategories)
    ? adminMember.assignedCategories : [];
  return cats.includes("all");
}

/* ───────── 기간 빌더 ───────── */
function buildPeriod(input: any): ReportPeriod {
  const type = String(input?.type || "");

  if (type === "quarterly") {
    const year = Number(input.year);
    const quarter = Number(input.quarter);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      throw new Error("연도는 2020~2100 범위여야 합니다");
    }
    if (![1, 2, 3, 4].includes(quarter)) {
      throw new Error("분기는 1~4 사이여야 합니다");
    }
    return periodForQuarter(year, quarter as 1 | 2 | 3 | 4);
  }

  if (type === "half") {
    const year = Number(input.year);
    const half = Number(input.half);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      throw new Error("연도는 2020~2100 범위여야 합니다");
    }
    if (![1, 2].includes(half)) {
      throw new Error("반기는 1 또는 2여야 합니다");
    }
    return periodForHalf(year, half as 1 | 2);
  }

  if (type === "annual") {
    const year = Number(input.year);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      throw new Error("연도는 2020~2100 범위여야 합니다");
    }
    return periodForYear(year);
  }

  if (type === "custom") {
    if (!input.startDate || !input.endDate) {
      throw new Error("custom 기간은 startDate/endDate가 필요합니다");
    }
    const start = new Date(input.startDate);
    const end = new Date(input.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error("startDate/endDate 형식이 올바르지 않습니다");
    }
    if (start >= end) {
      throw new Error("startDate는 endDate보다 이전이어야 합니다");
    }
    /* 최대 3년까지 허용 */
    const maxMs = 3 * 365 * 24 * 60 * 60 * 1000;
    if (end.getTime() - start.getTime() > maxMs) {
      throw new Error("기간은 최대 3년까지 가능합니다");
    }
    return periodForCustom(start, end, input.label);
  }

  throw new Error(`유효하지 않은 기간 타입: ${type}`);
}

/* ───────── 슬러그 정규화 ───────── */
function normalizeSlug(s: string): string {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9가-힣\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

function autoSlug(period: ReportPeriod): string {
  const y = period.startDate.getFullYear();
  if (period.type === "quarterly") {
    const q = Math.floor(period.startDate.getMonth() / 3) + 1;
    return `report-${y}-q${q}`;
  }
  if (period.type === "half") {
    const h = period.startDate.getMonth() < 6 ? 1 : 2;
    return `report-${y}-h${h}`;
  }
  if (period.type === "annual") {
    return `report-${y}-annual`;
  }
  /* custom */
  const m = String(period.startDate.getMonth() + 1).padStart(2, "0");
  const d = String(period.startDate.getDate()).padStart(2, "0");
  return `report-${y}${m}${d}-${crypto.randomBytes(3).toString("hex")}`;
}

/* ───────── PDF → R2 업로드 헬퍼 ─────────
 * uploadToR2()가 내부에서 blobKey 생성 + blob_uploads INSERT까지 자동 처리.
 * 여기서는 단순 위임만 한다. */
async function uploadPdfToR2(opts: {
  pdfBytes: Uint8Array;
  fileName: string;
  uploaderId: number;
}): Promise<{ blobId: number; blobKey: string }> {
  const { pdfBytes, fileName, uploaderId } = opts;

  const result = await uploadToR2({
    buffer: Buffer.from(pdfBytes),
    originalName: fileName,
    mimeType: "application/pdf",
    context: "activity_report_pdf",
    uploadedByAdmin: uploaderId,
    isPublic: true,
  });

  if (!result.ok || !result.blobId || !result.blobKey) {
    throw new Error(result.error || "R2 업로드 실패");
  }

  return {
    blobId: result.blobId,
    blobKey: result.blobKey,
  };
}

/* ───────── 메인 핸들러 ───────── */
export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const { admin, member: adminMember } = guard.ctx;

  /* 목록/수정/삭제는 권한 검사 별도, 생성은 canGenerate 별도 처리 */

  try {
    /* ===== GET: 목록 또는 단건 조회 ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const isList = url.searchParams.get("list") === "1";

      /* ── 목록 조회 (?list=1) — C안 신규 ── */
      if (isList) {
        const page = Math.max(1, Number(url.searchParams.get("page") || 1));
        const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));
        const published = url.searchParams.get("published") || "";
        const yearStr = url.searchParams.get("year");

        const conds: any[] = [eq(activityPosts.category, "report")];
        if (published === "true") conds.push(eq(activityPosts.isPublished, true));
        else if (published === "false") conds.push(eq(activityPosts.isPublished, false));
        if (yearStr) {
          const yn = Number(yearStr);
          if (Number.isFinite(yn)) conds.push(eq(activityPosts.year, yn));
        }
        const where = conds.length === 1 ? conds[0] : and(...conds);

        const totalRes: any = await db
          .select({ c: sql<number>`COUNT(*)::int` })
          .from(activityPosts)
          .where(where as any);
        const total = Number(totalRes[0]?.c ?? 0);

        const list = await db
          .select({
            id: activityPosts.id,
            slug: activityPosts.slug,
            title: activityPosts.title,
            year: activityPosts.year,
            month: activityPosts.month,
            summary: activityPosts.summary,
            attachmentIds: activityPosts.attachmentIds,
            isPublished: activityPosts.isPublished,
            isPinned: activityPosts.isPinned,
            views: activityPosts.views,
            publishedAt: activityPosts.publishedAt,
            createdAt: activityPosts.createdAt,
            updatedAt: activityPosts.updatedAt,
          })
          .from(activityPosts)
          .where(where as any)
          .orderBy(desc(activityPosts.createdAt))
          .limit(limit)
          .offset((page - 1) * limit);

        /* PDF blob ID 추출 */
        const enriched = list.map((p: any) => {
          let pdfBlobId: number | null = null;
          try {
            const ids = typeof p.attachmentIds === "string"
              ? JSON.parse(p.attachmentIds)
              : p.attachmentIds;
            if (Array.isArray(ids) && ids.length > 0) pdfBlobId = ids[0];
          } catch (_) {}
          const pdfDownloadUrl = pdfBlobId
            ? `/api/blob-image?id=${pdfBlobId}&download=1`
            : null;
          return { ...p, pdfBlobId, pdfDownloadUrl };
        });

        return ok({
          list: enriched,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
      }

      /* ── 단건 조회 (postId 필수) ── */
      const postId = Number(url.searchParams.get("postId"));
      const wantPdf = url.searchParams.get("pdf") === "1";

      if (!Number.isFinite(postId)) return badRequest("postId 필요");

      const [post] = await db
        .select()
        .from(activityPosts)
        .where(eq(activityPosts.id, postId))
        .limit(1);

      if (!post) return notFound("활동보고서를 찾을 수 없습니다");
      if (post.category !== "report") {
        return badRequest("AI 활동보고서가 아닙니다");
      }

      /* ?pdf=1: 저장된 PDF blob으로 리다이렉트 (원본 시점 보존) */
      if (wantPdf) {
        let pdfBlobId: number | null = null;
        try {
          const attachIds: any = post.attachmentIds
            ? (typeof post.attachmentIds === "string"
                ? JSON.parse(post.attachmentIds)
                : post.attachmentIds)
            : [];
          if (Array.isArray(attachIds) && attachIds.length > 0) {
            /* 첨부파일 중 PDF (activity_report_pdf 컨텍스트) 우선 선택 */
            const blobRows = await db
              .select({
                id: blobUploads.id,
                mimeType: blobUploads.mimeType,
                context: blobUploads.context,
              })
              .from(blobUploads)
              .where(sql`${blobUploads.id} = ANY(${attachIds})`);
            const pdfBlob = blobRows.find((b: any) =>
              b.context === "activity_report_pdf" || b.mimeType === "application/pdf"
            );
            if (pdfBlob) pdfBlobId = pdfBlob.id;
          }
        } catch (e) {
          console.warn("[activity-report-ai GET] attachmentIds 파싱 실패:", e);
        }

        if (!pdfBlobId) {
          return notFound(
            "이 보고서에는 PDF 첨부파일이 없습니다. POST로 generatePdf:true 옵션을 주어 다시 생성해 주세요."
          );
        }

        /* blob-image 함수로 리다이렉트 (R2 presigned URL로 직접 다운로드) */
        return new Response(null, {
          status: 302,
          headers: {
            Location: `/api/blob-image?id=${pdfBlobId}&download=1`,
          },
        });
      }

      /* ?pdf 없음: HTML 본문 반환 */
      return ok({
        post: {
          id: post.id,
          slug: post.slug,
          title: post.title,
          year: post.year,
          month: post.month,
          contentHtml: post.contentHtml,
          isPublished: post.isPublished,
          isPinned: post.isPinned,
          attachmentIds: post.attachmentIds,
        },
      });
    }

    /* ===== PATCH: 제목/발행상태/고정/본문 수정 + PDF 재생성 — C안 ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const [existing] = await db
        .select()
        .from(activityPosts)
        .where(eq(activityPosts.id, id))
        .limit(1);
      if (!existing) return notFound("보고서를 찾을 수 없습니다");
      if (existing.category !== "report") return badRequest("AI 보고서가 아닙니다");

      const updates: any = {};
      if (typeof body.title === "string") {
        const t = body.title.trim().slice(0, 200);
        if (!t) return badRequest("제목은 비울 수 없습니다");
        updates.title = t;
      }
      if (typeof body.isPublished === "boolean") {
        updates.isPublished = body.isPublished;
        if (body.isPublished === true && !existing.publishedAt) {
          updates.publishedAt = new Date();
        }
      }
      if (typeof body.isPinned === "boolean") updates.isPinned = body.isPinned;

      let contentChanged = false;
      if (typeof body.contentHtml === "string") {
        const c = body.contentHtml.trim();
        if (c.length > 200000) {
          return badRequest("본문이 너무 깁니다 (최대 200,000자)");
        }
        updates.contentHtml = c;
        contentChanged = c !== (existing.contentHtml || "");
      }
      if (typeof body.summary === "string") {
        updates.summary = body.summary.trim().slice(0, 500);
      }

      if (Object.keys(updates).length === 0) {
        return badRequest("변경할 항목이 없습니다");
      }

      updates.updatedBy = admin.uid;
      updates.updatedAt = new Date();

      const [updated] = await db
        .update(activityPosts)
        .set(updates)
        .where(eq(activityPosts.id, id))
        .returning();

      /* C안: 본문 변경 또는 명시적 regeneratePdf 시 PDF 재생성 */
      const shouldRegenerate = (contentChanged || body.regeneratePdf === true);
      let newPdfBlobId: number | null = null;
      let pdfWarning: string | null = null;

      if (false && shouldRegenerate) { /* v13.1: PDF 재생성 비활성화 — 브라우저 인쇄로 전환 */
        try {
          /* 1. 기간 복원 — slug 또는 year/month로 추정 */
          const finalContentHtml = updates.contentHtml || existing.contentHtml || "";

          /* 보고서 기간을 메타에서 추정 */
          let period: ReportPeriod;
          const slug = String(existing.slug || "");
          const year = existing.year || new Date().getFullYear();
          if (slug.includes("-q1") || slug.includes("-q2") || slug.includes("-q3") || slug.includes("-q4")) {
            const qm = slug.match(/-q([1-4])/);
            const q = qm ? Number(qm[1]) as 1|2|3|4 : 1;
            period = periodForQuarter(year, q);
          } else if (slug.includes("-h1") || slug.includes("-h2")) {
            const hm = slug.match(/-h([12])/);
            const h = hm ? Number(hm[1]) as 1|2 : 1;
            period = periodForHalf(year, h);
          } else if (slug.includes("annual") || !existing.month) {
            period = periodForYear(year);
          } else {
            /* 월별 또는 알 수 없으면 연간으로 폴백 */
            period = periodForYear(year);
          }

          /* 2. 데이터 재수집 (최신 데이터로) */
          const reportData = await collectReportData(period);

          /* 3. 협회 정보 */
          const [rs] = await db.select().from(receiptSettings).where(eq(receiptSettings.id, 1)).limit(1);
          const orgInfo = rs ? {
            name: rs.orgName || undefined,
            address: rs.orgAddress || undefined,
            phone: rs.orgPhone || undefined,
          } : {};

          /* 4. PDF 빌드 (수정된 본문 기준 + 이미지 포함) */
          const fakeGenerated: any = {
            title: updates.title || existing.title || "활동보고서",
            greeting: "", highlights: "", detailedAnalysis: "",
            trendAnalysis: "", futureOutlook: "", conclusion: "",
            fullHtml: finalContentHtml,
            generatedAt: new Date(),
            aiModel: "사람 검토 반영본",
          };

          const pdfBytes = await buildActivityReportPdf({
            data: reportData,
            generated: fakeGenerated,
            orgInfo,
            customContentHtml: finalContentHtml,
          });

          /* 5. 새 PDF 업로드 */
          const fileName = `activity-report-${slug || "report"}-rev${Date.now()}.pdf`;
          const uploaded = await uploadPdfToR2({
            pdfBytes,
            fileName,
            uploaderId: admin.uid,
          });
          newPdfBlobId = uploaded.blobId;

          /* 6. 기존 PDF blob의 reference 해제 (자동 cleanup에 맡김) */
          let oldBlobIds: number[] = [];
          try {
            const ids = typeof existing.attachmentIds === "string"
              ? JSON.parse(existing.attachmentIds)
              : existing.attachmentIds;
            if (Array.isArray(ids)) oldBlobIds = ids.filter((x: any) => Number.isInteger(x));
          } catch (_) {}

          for (const bid of oldBlobIds) {
            try {
              await db.update(blobUploads).set({
                referenceTable: null,
                referenceId: null,
              } as any).where(eq(blobUploads.id, bid));
            } catch (_) {}
          }

          /* 7. attachmentIds 갱신 */
          await db.update(activityPosts).set({
            attachmentIds: JSON.stringify([newPdfBlobId]),
          } as any).where(eq(activityPosts.id, id));

          /* 8. 새 blob의 reference 연결 */
          await db.update(blobUploads).set({
            referenceTable: "activity_posts",
            referenceId: id,
          } as any).where(eq(blobUploads.id, newPdfBlobId));

          console.log(`[activity-report-ai PATCH] PDF 재생성 완료: post-${id} → blob-${newPdfBlobId}`);
        } catch (e: any) {
          console.error("[activity-report-ai PATCH] PDF 재생성 실패:", e);
          pdfWarning = e?.message || "PDF 재생성 중 오류";
          /* PDF 실패해도 본문 저장은 정상 처리 */
        }
      }

      try {
        await logAdminAction(req, admin.uid, admin.name, "activity_report_update", {
          target: `R-${id}`,
          detail: {
            changedFields: Object.keys(updates),
            pdfRegenerated: !!newPdfBlobId,
            pdfWarning,
          },
        });
      } catch (_) {}

      return ok({
        post: updated,
        pdfRegenerated: !!newPdfBlobId,
        newPdfBlobId,
        pdfWarning,
      }, newPdfBlobId
        ? "수정 + PDF가 재생성되었습니다"
        : (pdfWarning ? `수정 완료 (PDF 재생성 실패: ${pdfWarning})` : "수정되었습니다")
      );
    }

    /* ===== DELETE: 보고서 삭제 — C안 신규 ===== */
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const [existing] = await db
        .select()
        .from(activityPosts)
        .where(eq(activityPosts.id, id))
        .limit(1);
      if (!existing) return notFound("보고서를 찾을 수 없습니다");
      if (existing.category !== "report") return badRequest("AI 보고서가 아닙니다");

      /* PDF blob의 reference 해제 (자동 cleanup에 맡김) */
      let pdfBlobIds: number[] = [];
      try {
        const ids = typeof existing.attachmentIds === "string"
          ? JSON.parse(existing.attachmentIds)
          : existing.attachmentIds;
        if (Array.isArray(ids)) pdfBlobIds = ids.filter((x: any) => Number.isInteger(x));
      } catch (_) {}

      await db.delete(activityPosts).where(eq(activityPosts.id, id));

      for (const bid of pdfBlobIds) {
        try {
          await db.update(blobUploads).set({
            referenceTable: null,
            referenceId: null,
          } as any).where(eq(blobUploads.id, bid));
        } catch (_) {}
      }

      try {
        await logAdminAction(req, admin.uid, admin.name, "activity_report_delete", {
          target: `R-${id}`,
          detail: { title: existing.title, year: existing.year, pdfBlobIds },
        });
      } catch (_) {}

      return ok({ deletedId: id }, "보고서가 삭제되었습니다");
    }

    /* ===== POST: 보고서 생성 ===== */
    if (req.method !== "POST") return methodNotAllowed();

    /* POST는 canGenerate 권한 필요 */
    if (!canGenerate(adminMember)) {
      return forbidden("AI 활동보고서 생성 권한이 없습니다 (super_admin 또는 'all' 담당자만 가능)");
    }

    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    /* 1. 기간 빌드 */
    let period: ReportPeriod;
    try {
      period = buildPeriod(body.period);
    } catch (e: any) {
      return badRequest(e.message || "유효하지 않은 기간");
    }

    const saveAsPost = body.saveAsPost === true;
    const generatePdf = body.generatePdf === true;
    const customTitle = String(body.postTitle || "").trim().slice(0, 200);
    const customSlug = body.postSlug ? normalizeSlug(String(body.postSlug)) : null;

    console.log(`[activity-report-ai] 시작: ${period.label} (${period.startDate.toISOString()} ~ ${period.endDate.toISOString()})`);
    const t0 = Date.now();

    /* 2. 데이터 수집 */
    let reportData: any;
    try {
      reportData = await collectReportData(period);
    } catch (e: any) {
      console.error("[activity-report-ai] 데이터 수집 실패:", e);
      return serverError("데이터 수집 실패", e.message);
    }
    const t1 = Date.now();
    console.log(`[activity-report-ai] 데이터 수집 완료: ${t1 - t0}ms`);

    /* 3. AI 보고서 생성 */
    let generated: any;
    try {
      generated = await generateActivityReport(reportData);
    } catch (e: any) {
      console.error("[activity-report-ai] AI 생성 실패:", e);
      return serverError("AI 보고서 생성 실패", e.message);
    }
    const t2 = Date.now();
    console.log(`[activity-report-ai] AI 생성 완료: ${t2 - t1}ms`);

    /* 4. activity_posts에 저장 (선택) */
    let savedPostId: number | null = null;
    let savedSlug: string | null = null;

    if (saveAsPost) {
      const slug = customSlug || autoSlug(period);

      /* 슬러그 중복 체크 */
      const [dup] = await db
        .select({ id: activityPosts.id })
        .from(activityPosts)
        .where(eq(activityPosts.slug, slug))
        .limit(1);

      if (dup) {
        return badRequest(`이미 사용 중인 슬러그입니다: ${slug}. 다른 슬러그를 지정하거나 자동 생성을 사용하세요.`);
      }

      const insertData: any = {
        slug,
        year: period.startDate.getFullYear(),
        month: period.type === "quarterly" || period.type === "half"
          ? period.startDate.getMonth() + 1
          : null,
        category: "report",
        title: customTitle || generated.title,
        summary: `${period.label} 활동보고서 (AI 자동 생성)`.slice(0, 500),
        contentHtml: generated.fullHtml,
        isPublished: false, /* 초안으로 저장 */
        isPinned: false,
        sortOrder: 0,
        publishedAt: new Date(),
        updatedBy: admin.uid,
      };

      const [inserted] = await db
        .insert(activityPosts)
        .values(insertData)
        .returning({ id: activityPosts.id, slug: activityPosts.slug });

      savedPostId = inserted.id;
      savedSlug = inserted.slug;
      console.log(`[activity-report-ai] 게시글 저장 완료: post-${savedPostId}`);
    }

    /* 5. PDF 생성 (선택) */
    let pdfBlobId: number | null = null;
    let pdfDownloadUrl: string | null = null;

    if (false && generatePdf) { /* v13.1: PDF 생성 비활성화 — 브라우저 인쇄로 전환 */
      try {
        /* 협회 정보 조회 (영수증 설정에서 재사용) */
        const [rs] = await db.select().from(receiptSettings).where(eq(receiptSettings.id, 1)).limit(1);
        const orgInfo = rs ? {
          name: rs.orgName || undefined,
          address: rs.orgAddress || undefined,
          phone: rs.orgPhone || undefined,
        } : {};

        const pdfBytes = await buildActivityReportPdf({
          data: reportData,
          generated,
          orgInfo,
        });

        const fileName = `activity-report-${autoSlug(period)}.pdf`;
        const uploaded = await uploadPdfToR2({
          pdfBytes,
          fileName,
          uploaderId: admin.uid,
        });

        pdfBlobId = uploaded.blobId;
        pdfDownloadUrl = `/api/blob-image?id=${pdfBlobId}&download=1`;

        /* 저장된 게시글이 있으면 첨부파일로 연결 */
        if (savedPostId) {
          await db.update(activityPosts).set({
            attachmentIds: JSON.stringify([pdfBlobId]),
          } as any).where(eq(activityPosts.id, savedPostId));

          /* blob_uploads의 reference 갱신 */
          await db.update(blobUploads).set({
            referenceTable: "activity_posts",
            referenceId: savedPostId,
          } as any).where(eq(blobUploads.id, pdfBlobId));
        }

        const t3 = Date.now();
        console.log(`[activity-report-ai] PDF 생성 완료: ${t3 - t2}ms (size=${pdfBytes.length})`);
      } catch (e: any) {
        console.error("[activity-report-ai] PDF 생성 실패:", e);
        /* PDF 실패해도 HTML 보고서는 응답 */
      }
    }

    /* 6. 감사 로그 */
    try {
      await logAdminAction(req, admin.uid, admin.name, "activity_report_ai_generate", {
        target: period.label,
        detail: {
          periodType: period.type,
          startDate: period.startDate.toISOString(),
          endDate: period.endDate.toISOString(),
          totalDonations: reportData.donations.totalAmount,
          totalDonors: reportData.donations.donorCount,
          newMembers: reportData.members.newMembersCount,
          aiModel: generated.aiModel,
          savedPostId,
          pdfBlobId,
          durationMs: Date.now() - t0,
        },
      });
    } catch (_) {}

    /* 7. 응답 */
    return ok({
      generated: {
        title: generated.title,
        greeting: generated.greeting,
        highlights: generated.highlights,
        detailedAnalysis: generated.detailedAnalysis,
        trendAnalysis: generated.trendAnalysis,
        futureOutlook: generated.futureOutlook,
        conclusion: generated.conclusion,
        fullHtml: generated.fullHtml,
        aiModel: generated.aiModel,
      },
      stats: {
        period: {
          type: period.type,
          label: period.label,
          startDate: period.startDate.toISOString(),
          endDate: period.endDate.toISOString(),
        },
        donations: {
          totalAmount: reportData.donations.totalAmount,
          totalCount: reportData.donations.totalCount,
          donorCount: reportData.donations.donorCount,
          growthRate: reportData.donations.growthRate,
        },
        members: {
          newCount: reportData.members.newMembersCount,
          totalActive: reportData.members.totalMembersAtEnd,
        },
        support: {
          total: reportData.support.totalCount,
          completed: reportData.support.byStatus.completed,
        },
      },
      saved: savedPostId ? {
        postId: savedPostId,
        slug: savedSlug,
        editUrl: `/admin.html#content`,
      } : null,
      pdf: pdfBlobId ? {
        blobId: pdfBlobId,
        downloadUrl: pdfDownloadUrl,
      } : null,
      timing: {
        dataCollectMs: t1 - t0,
        aiGenerateMs: t2 - t1,
        totalMs: Date.now() - t0,
      },
    }, "활동보고서가 생성되었습니다");
  } catch (err: any) {
    console.error("[admin-activity-report-ai]", err);
    return serverError("보고서 생성 중 오류", err?.message);
  }
};

export const config = { path: "/api/admin/activity-report-ai" };