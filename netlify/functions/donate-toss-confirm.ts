/**
 * POST /api/donate-toss-confirm
 *
 * 토스 결제 승인 (Confirm 단계)
 * - payment-success.html이 호출
 * - 토스 API로 결제 승인 요청 → 성공 시 DB 업데이트
 * - 영수증 번호 자동 발급 (TBFA-YYYY-NNNNNN)
 * - 감사 메일 자동 발송 (실패해도 결제는 성공 처리)
 *
 * Body: { paymentKey, orderId, amount, donationId? }
 *
 * 보안:
 * - 토스 API 호출은 시크릿 키로 (서버 측에서만)
 * - amount 위변조 방지 (DB amount === 토스 응답 amount === 요청 amount 3중 검증)
 * - orderId로 donations 행 매칭 → 본인 결제만 confirm 가능
 * - 이미 completed면 중복 처리 방지
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, donations, members } from "../../db";
import { safeValidate } from "../../lib/validation";
import {
  ok, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";
import { sendEmail, tplDonationThanks } from "../../lib/email";


/* ───────── 토스 API 설정 ───────── */
const TOSS_MODE = (process.env.TOSS_MODE || "test").toLowerCase();
const TOSS_SECRET_KEY =
  TOSS_MODE === "live"
    ? (process.env.TOSS_LIVE_SECRET_KEY || "")
    : (process.env.TOSS_TEST_SECRET_KEY || "");


const TOSS_API_BASE = "https://api.tosspayments.com/v1";


/* ───────── 검증 스키마 ───────── */
const confirmSchema = z.object({
  paymentKey: z.string().trim().min(10, "유효하지 않은 paymentKey"),
  orderId: z.string().trim().min(6, "유효하지 않은 orderId"),
  amount: z.number().int().min(1000).max(100_000_000),
  donationId: z.number().int().positive().optional(),
});


/* ───────── 영수증 번호 생성 ───────── */
function generateReceiptNumber(donationId: number): string {
  const year = new Date().getFullYear();
  const padded = String(donationId).padStart(6, "0");
  return `TBFA-${year}-${padded}`;
}


export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();


  try {
    /* 1. 환경변수 검증 */
    if (!TOSS_SECRET_KEY) {
      console.error("[donate-toss-confirm] TOSS_SECRET_KEY 환경변수 미설정");
      return serverError("결제 시스템이 일시 점검 중입니다 (관리자에게 문의)");
    }


    /* 2. 입력 파싱 + 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");


    const v: any = safeValidate(confirmSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);


    const { paymentKey, orderId, amount } = v.data;
    const donationId: number | undefined = v.data.donationId;


    /* 3. donations 행 조회 (orderId 우선, 없으면 donationId) */
    let donation: any = null;
    if (orderId) {
      const [row] = await db
        .select()
        .from(donations)
        .where(eq(donations.tossOrderId, orderId))
        .limit(1);
      donation = row;
    }
    if (!donation && donationId) {
      const [row] = await db
        .select()
        .from(donations)
        .where(eq(donations.id, donationId))
        .limit(1);
      donation = row;
    }


    if (!donation) {
      return notFound("주문 정보를 찾을 수 없습니다");
    }


    /* 4. 이미 처리된 결제면 중복 방지 */
    if (donation.status === "completed") {
      console.log("[donate-toss-confirm] 이미 완료된 결제:", donation.id);
      /* 멱등성 보장 — 같은 응답 반환 */
      return ok({
        donationId: donation.id,
        donationNo: `D-${String(donation.id).padStart(7, "0")}`,
        donorName: donation.donorName,
        amount: donation.amount,
        paidAt: donation.updatedAt,
        method: "신용카드 (토스)",
        receiptNumber: donation.receiptNumber,
        alreadyProcessed: true,
      }, "이미 완료된 결제입니다");
    }


    /* 5. amount 위변조 검증 (요청 ↔ DB) */
    if (donation.amount !== amount) {
      console.error("[donate-toss-confirm] amount 불일치:", {
        dbAmount: donation.amount,
        requestAmount: amount,
        donationId: donation.id,
      });
      await logUserAction(req, donation.memberId, donation.donorName, "donate_toss_amount_mismatch", {
        target: orderId,
        detail: { dbAmount: donation.amount, requestAmount: amount },
        success: false,
      });
      return badRequest("결제 금액이 일치하지 않습니다");
    }


    /* 6. 토스 API에 confirm 요청 */
    const authHeader = "Basic " + Buffer.from(TOSS_SECRET_KEY + ":").toString("base64");


    let tossResponse: any;
    try {
      const tossRes = await fetch(`${TOSS_API_BASE}/payments/confirm`, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          paymentKey,
          orderId,
          amount,
        }),
      });


      tossResponse = await tossRes.json();


      if (!tossRes.ok) {
        /* 토스 API 응답 에러 (4xx/5xx) */
        console.error("[donate-toss-confirm] 토스 API 에러:", tossResponse);


        /* DB를 failed로 변경 */
        const failPayload: any = {
          status: "failed",
          tossPaymentKey: paymentKey,
          failureReason: tossResponse?.message || "토스 결제 승인 거부",
          updatedAt: new Date(),
        };
        await db
          .update(donations)
          .set(failPayload)
          .where(eq(donations.id, donation.id));


        await logUserAction(req, donation.memberId, donation.donorName, "donate_toss_confirm_failed", {
          target: orderId,
          detail: {
            tossCode: tossResponse?.code,
            tossMessage: tossResponse?.message,
            paymentKey,
          },
          success: false,
        });


        return badRequest(
          tossResponse?.message || "결제 승인에 실패했습니다",
          { code: tossResponse?.code, detail: tossResponse?.message },
        );
      }
    } catch (tossErr: any) {
      console.error("[donate-toss-confirm] 토스 네트워크 에러:", tossErr);
      return serverError("결제 시스템 통신 오류가 발생했습니다", tossErr?.message);
    }


    /* 7. 토스 응답 검증 (amount 3중 체크) */
    if (Number(tossResponse?.totalAmount) !== amount) {
      console.error("[donate-toss-confirm] 토스 응답 amount 불일치:", {
        tossAmount: tossResponse?.totalAmount,
        requestAmount: amount,
      });
      return badRequest("결제 금액 검증 실패 (토스 응답 불일치)");
    }


    /* 8. 영수증 번호 생성 */
    const receiptNumber = generateReceiptNumber(donation.id);


    /* 9. donations 테이블 업데이트 (completed) */
    const updatePayload: any = {
      status: "completed",
      tossPaymentKey: paymentKey,
      transactionId: paymentKey,
      receiptIssued: true,
      receiptIssuedAt: new Date(),
      receiptNumber,
      receiptRequested: true,
      updatedAt: new Date(),
    };


    const [updated] = await db
      .update(donations)
      .set(updatePayload)
      .where(eq(donations.id, donation.id))
      .returning({
        id: donations.id,
        donorName: donations.donorName,
        donorEmail: donations.donorEmail,
        amount: donations.amount,
        type: donations.type,
        payMethod: donations.payMethod,
        memberId: donations.memberId,
        receiptNumber: donations.receiptNumber,
        updatedAt: donations.updatedAt,
      });


    /* 10. 감사 메일 발송 (실패해도 결제는 성공 처리) */
    let emailSent = false;
    try {
      const recipientEmail = updated.donorEmail;
      if (recipientEmail) {
        const tpl = tplDonationThanks({
          donorName: updated.donorName,
          amount: updated.amount,
          donationType: updated.type as string,
          payMethod: "card",
          donationId: updated.id,
          donationDate: new Date(),
          isMember: !!updated.memberId,
        });
        const mailResult = await sendEmail({
          to: recipientEmail,
          subject: tpl.subject,
          html: tpl.html,
        });
        emailSent = !!mailResult.ok;
      }
    } catch (mailErr) {
      console.error("[donate-toss-confirm] 감사 메일 예외:", mailErr);
    }


    /* 11. 감사 로그 */
    await logUserAction(req, updated.memberId, updated.donorName, "donate_toss_confirm_success", {
      target: orderId,
      detail: {
        donationId: updated.id,
        amount: updated.amount,
        paymentKey,
        receiptNumber,
        emailSent,
      },
    });


    /* 12. 성공 응답 */
    const donationNo = `D-${String(updated.id).padStart(7, "0")}`;
    return ok({
      donationId: updated.id,
      donationNo,
      donorName: updated.donorName,
      amount: updated.amount,
      paidAt: updated.updatedAt,
      method: "신용카드 (토스)",
      receiptNumber: updated.receiptNumber,
      emailSent,
    }, "결제가 완료되었습니다");
  } catch (err) {
    console.error("[donate-toss-confirm]", err);
    return serverError("결제 처리 중 오류가 발생했습니다", err);
  }
};


export const config = { path: "/api/donate-toss-confirm" };
