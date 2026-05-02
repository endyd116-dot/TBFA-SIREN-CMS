/**
 * GET /api/donation-receipt?id=N         — PDF 영수증 (브라우저 인라인 표시)
 * GET /api/donation-receipt?id=N&dl=1    — 강제 다운로드
 *
 * 권한:
 *   - 본인 후원 (memberId 일치)
 *   - 또는 관리자 (모든 후원 접근 가능)
 *
 * 발급 조건:
 *   - donations.status === "completed"
 *   - 자동으로 receipt_number 발급 + DB 저장 (1회만)
 *
 * STEP H-2c
 */
import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db, donations } from "../../db";
import { authenticateUser, authenticateAdmin } from "../../lib/auth";
import { issueReceiptNumber } from "../../lib/receipt-number";
import { generateReceiptPDF } from "../../lib/pdf-receipt";

export const config = { path: "/api/donation-receipt" };

export default async (req: Request, _ctx: Context) => {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const isDownload = url.searchParams.get("dl") === "1";

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

    /* 2) 권한 검증 (관리자 우선 → 사용자 본인) */
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

    /* 4) 영수증 번호 발급 (없으면 신규, 있으면 기존) */
    const { receiptNumber, isNew } = await issueReceiptNumber(donationId);
    console.log(
      `[donation-receipt] id=${donationId} receiptNumber=${receiptNumber} isNew=${isNew}`
    );

    /* 5) PDF 생성 */
    const pdfBytes = await generateReceiptPDF({
      receiptNumber,
      donorName: (d as any).donorName,
      donorEmail: (d as any).donorEmail,
      donorPhone: (d as any).donorPhone,
      amount: (d as any).amount,
      donationDate: new Date((d as any).createdAt),
      payMethod: (d as any).payMethod,
      donationType: (d as any).type,
    });

    /* 6) 응답 헤더 (인라인 vs 다운로드) */
    const fileName = `기부금영수증_${receiptNumber}.pdf`;
    const encoded = encodeURIComponent(fileName);
    const headers: Record<string, string> = {
      "content-type": "application/pdf",
      "cache-control": "private, no-cache",
    };

    if (isDownload) {
      headers["content-disposition"] =
        `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`;
    } else {
      headers["content-disposition"] =
        `inline; filename="${encoded}"; filename*=UTF-8''${encoded}`;
    }

    /* Buffer 변환 (Netlify Functions에서 안정적인 응답) */
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