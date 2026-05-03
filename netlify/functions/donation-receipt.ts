/**
 * GET /api/donation-receipt?id=N         — PDF 영수증 (인라인)
 * GET /api/donation-receipt?id=N&dl=1    — 다운로드
 *
 * ★ M-14:
 * - 첫 발급 시 R2에 PDF 저장 + donations.receipt_blob_id 기록
 * - 재발급 시 R2에서 캐시된 PDF 반환 (동일 영수증 일관성 보장)
 * - regenerate=1 쿼리로 강제 재생성 가능 (관리자만)
 */
import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db, donations } from "../../db";
import { blobUploads } from "../../db/schema";
import { authenticateUser, authenticateAdmin } from "../../lib/auth";
import { issueReceiptNumber } from "../../lib/receipt-number";
import { generateReceiptPDF } from "../../lib/pdf-receipt";
import { uploadToR2, downloadFromR2 } from "../../lib/r2-server";

export const config = { path: "/api/donation-receipt" };

export default async (req: Request, _ctx: Context) => {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const isDownload = url.searchParams.get("dl") === "1";
    const forceRegenerate = url.searchParams.get("regenerate") === "1";

    if (!id || !/^\d+$/.test(id)) {
      return new Response(
        JSON.stringify({ ok: false, error: "id required" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    const donationId = Number(id);

    /* 1) 후원 조회 */
    const [d] = await db
      .select()
      .from(donations)
      .where(eq(donations.id, donationId))
      .limit(1);

    if (!d) {
      return new Response(
        JSON.stringify({ ok: false, error: "후원 내역을 찾을 수 없습니다" }),
        { status: 404, headers: { "content-type": "application/json" } }
      );
    }

    /* 2) 권한 검증 */
    const admin = authenticateAdmin(req);
    let allowed = !!admin;

    if (!allowed) {
      const user = authenticateUser(req);
      if (!user) {
        return new Response(
          JSON.stringify({ ok: false, error: "로그인이 필요합니다" }),
          { status: 401, headers: { "content-type": "application/json" } }
        );
      }
      if ((d as any).memberId === user.uid) {
        allowed = true;
      }
    }

    if (!allowed) {
      return new Response(
        JSON.stringify({ ok: false, error: "접근 권한이 없습니다" }),
        { status: 403, headers: { "content-type": "application/json" } }
      );
    }

    /* 3) 발급 조건: 결제 완료된 후원만 */
    if ((d as any).status !== "completed") {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "결제 완료된 후원만 영수증 발급이 가능합니다",
          currentStatus: (d as any).status,
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    /* 4) 영수증 번호 발급 */
    const { receiptNumber, isNew } = await issueReceiptNumber(donationId);
    console.log(
      `[donation-receipt] id=${donationId} receiptNumber=${receiptNumber} isNew=${isNew} forceRegen=${forceRegenerate}`
    );

    /* 5) ★ M-14: R2 캐시 활용
       - donations.receipt_blob_id가 있고 forceRegenerate가 false면 캐시 반환
       - regenerate=1은 관리자만 허용 */
    let pdfBytes: Uint8Array | null = null;
    let cacheHit = false;

    const existingBlobId = (d as any).receiptBlobId;
    const useCache = existingBlobId && !forceRegenerate;
    const allowRegenerate = forceRegenerate && !!admin;

    if (forceRegenerate && !admin) {
      return new Response(
        JSON.stringify({ ok: false, error: "강제 재생성은 관리자만 가능합니다" }),
        { status: 403, headers: { "content-type": "application/json" } }
      );
    }

    if (useCache) {
      try {
        const [cached] = await db
          .select({ blobKey: blobUploads.blobKey, mimeType: blobUploads.mimeType })
          .from(blobUploads)
          .where(eq(blobUploads.id, existingBlobId))
          .limit(1);

        if (cached && (cached as any).blobKey) {
          const downloaded = await downloadFromR2((cached as any).blobKey);
          if (downloaded && downloaded.length > 100) {
            pdfBytes = downloaded;
            cacheHit = true;
            console.log(`[donation-receipt] 캐시 히트: blobId=${existingBlobId}`);
          }
        }
      } catch (e) {
        console.warn(`[donation-receipt] 캐시 조회 실패, 신규 생성:`, e);
      }
    }

    /* 6) 캐시 미스 또는 강제 재생성 → PDF 신규 생성 */
    if (!pdfBytes) {
      pdfBytes = await generateReceiptPDF({
        receiptNumber,
        donorName: (d as any).donorName,
        donorEmail: (d as any).donorEmail,
        donorPhone: (d as any).donorPhone,
        amount: (d as any).amount,
        donationDate: new Date((d as any).createdAt),
        payMethod: (d as any).payMethod,
        donationType: (d as any).type,
      });

      /* R2 저장 + DB 기록 */
      try {
        const fileName = `기부금영수증_${receiptNumber}.pdf`;
        const uploadResult = await uploadToR2({
          buffer: pdfBytes,
          originalName: fileName,
          mimeType: "application/pdf",
          context: "receipt",
          uploadedByAdmin: admin ? (admin as any).uid : null,
          uploadedBy: !admin ? ((d as any).memberId || null) : null,
          isPublic: false,         /* 영수증은 비공개 (인증 통과한 사람만 접근) */
          expiresInDays: null,     /* 만료 없음 — 영구 보관 */
        });

        if (uploadResult.ok && uploadResult.blobId) {
          await db.update(donations)
            .set({ receiptBlobId: uploadResult.blobId } as any)
            .where(eq(donations.id, donationId));

          console.log(`[donation-receipt] 신규 R2 저장: blobId=${uploadResult.blobId}, regen=${forceRegenerate}`);

          /* 강제 재생성이면 기존 BLOB 삭제는 안 함 (감사 추적용 보존) */
        } else {
          console.warn(`[donation-receipt] R2 저장 실패 (PDF는 정상 응답): ${uploadResult.error}`);
        }
      } catch (uploadErr) {
        /* R2 저장 실패해도 PDF 응답은 정상 진행 */
        console.error("[donation-receipt] R2 저장 중 예외:", uploadErr);
      }
    }

    /* 7) 응답 헤더 */
    const fileName = `기부금영수증_${receiptNumber}.pdf`;
    const encoded = encodeURIComponent(fileName);
    const headers: Record<string, string> = {
      "content-type": "application/pdf",
      "cache-control": "private, no-cache",
      "x-cache-hit": cacheHit ? "1" : "0",
    };

    if (isDownload) {
      headers["content-disposition"] =
        `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`;
    } else {
      headers["content-disposition"] =
        `inline; filename="${encoded}"; filename*=UTF-8''${encoded}`;
    }

    return new Response(Buffer.from(pdfBytes) as any, { status: 200, headers });
  } catch (e: any) {
    console.error("[donation-receipt] error", e);
    return new Response(
      JSON.stringify({
        ok: false,
        error: e?.message || "internal error",
        stack: process.env.NODE_ENV === "development" ? e?.stack : undefined,
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};