/**
 * SIREN — 영수증 미리보기 API (STEP H-2d-3)
 *
 * GET /api/admin/receipt-preview          — 현재 DB 설정으로 샘플 PDF 미리보기
 * GET /api/admin/receipt-preview?dl=1     — 다운로드 모드
 *
 * 동작:
 *   - 실제 후원 데이터를 사용하지 않고 샘플 데이터로 PDF 생성
 *   - 관리자가 영수증 설정을 저장한 후, 실제로 어떻게 보이는지 확인하는 용도
 *   - 권한: 관리자만
 */
import type { Context } from "@netlify/functions";
import { generateReceiptPDF } from "../../lib/pdf-receipt";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin/receipt-preview" };

export default async (req: Request, _ctx: Context) => {
  try {
    /* 관리자 인증 */
    const guard: any = await requireAdmin(req);
    if (!guard.ok) return guard.res;

    const url = new URL(req.url);
    const isDownload = url.searchParams.get("dl") === "1";

    /* 샘플 영수증 데이터 */
    const sampleData = {
      receiptNumber: "TBFA-2026-PREVIEW",
      donorName: "홍길동",
      donorEmail: "sample@example.com",
      donorPhone: "010-1234-5678",
      amount: 100000,
      donationDate: new Date(),
      payMethod: "card",
      donationType: "regular",
    };

    /* PDF 생성 (DB 설정 자동 반영) */
    const pdfBytes = await generateReceiptPDF(sampleData);

    /* 응답 헤더 */
    const fileName = `영수증_미리보기_${new Date().getTime()}.pdf`;
    const encoded = encodeURIComponent(fileName);
    const headers: Record<string, string> = {
      "content-type": "application/pdf",
      "cache-control": "no-store",
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
    console.error("[admin-receipt-preview] error", e);
    return new Response(
      JSON.stringify({
        ok: false,
        error: e?.message || "internal error",
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};