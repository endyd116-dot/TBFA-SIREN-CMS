/**
 * POST /api/billing-confirm
 *
 * 토스 빌링키 발급 + 첫 결제 처리
 * - billing-success.html이 호출 (토스 authKey 받은 후)
 * - 토스 API: 빌링키 발급 (authKey → billingKey)
 * - 토스 API: 빌링키로 첫 결제 즉시 호출
 * - billingKeys 테이블 INSERT (활성)
 * - donations 테이블 INSERT (첫 결제 completed)
 * - 영수증 발급 + 감사 메일 발송
 *
 * Body: { authKey, customerKey, amount, name, phone, email, isAnonymous }
 *
 * 보안:
 * - 시크릿 키 서버 측만
 * - amount 검증
 * - 회원당 1개 활성 빌링키 (중복 방지)
 * - 멱등성 (같은 customerKey + authKey 재호출 시 안전)
 */
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";
import { db, billingKeys, donations, members } from "../../db";
import { authenticateUser } from "../../lib/auth";
import { safeValidate } from "../../lib/validation";
import {
  ok, badRequest, forbidden, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";
import { sendEmail, tplDonationThanks } from "../../lib/email";

const TOSS_MODE = (process.env.TOSS_MODE || "test").toLowerCase();
const TOSS_SECRET_KEY =
  TOSS_MODE === "live"
    ? (process.env.TOSS_LIVE_SECRET_KEY || "")
    : (process.env.TOSS_TEST_SECRET_KEY || "");

const TOSS_API_BASE = "https://api.tosspayments.com/v1";

const confirmSchema = z.object({
  authKey: z.string().trim().min(10),
  customerKey: z.string().trim().min(2).max(64),
  amount: z.number().int().min(1000).max(100_000_000),
  name: z.string().trim().min(2).max(50),
  phone: z.string().trim().regex(/^[0-9\-+\s()]{8,20}$/),
  email: z.string().trim().toLowerCase().email(),
  isAnonymous: z.boolean().optional().default(false),
});

function generateTossOrderId(prefix = "BILL"): string {
  const now = new Date();
  const ym = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, "0");
  const rand = crypto.randomBytes(5).toString("hex");
  return `${prefix}-${ym}-${rand}`;
}

function generateReceiptNumber(donationId: number): string {
  const year = new Date().getFullYear();
  const padded = String(donationId).padStart(6, "0");
  return `TBFA-${year}-${padded}`;
}

function calcNextChargeDate(from: Date): Date {
  const next = new Date(from);
  next.setMonth(next.getMonth() + 1);
  return next;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 환경변수 검증 */
    if (!TOSS_SECRET_KEY) {
      console.error("[billing-confirm] TOSS_SECRET_KEY 미설정");
      return serverError("결제 시스템이 일시 점검 중입니다 (관리자에게 문의)");
    }

    /* 2. 입력 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v: any = safeValidate(confirmSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);

    const data = v.data;

    /* 3. 회원 식별 */
    let memberId: number | null = null;
    const auth = authenticateUser(req);
    if (auth) {
      const [user] = await db
        .select({ id: members.id, status: members.status })
        .from(members)
        .where(eq(members.id, auth.uid))
        .limit(1);
      if (user && user.status !== "withdrawn" && user.status !== "suspended") {
        memberId = user.id;
      }
    }

    /* 4. 멱등성 — 같은 customerKey로 이미 빌링키 있으면 그것을 반환 */
    const [existingByCustomer] = await db
      .select()
      .from(billingKeys)
      .where(eq(billingKeys.customerKey, data.customerKey))
      .limit(1);

    if (existingByCustomer && existingByCustomer.isActive) {
      console.log("[billing-confirm] 이미 처리된 customerKey:", data.customerKey);
      return ok({
        donationNo: `D-${String(existingByCustomer.id).padStart(7, "0")}`,
        amount: existingByCustomer.amount,
        donorName: data.name,
        cardCompany: existingByCustomer.cardCompany,
        cardNumberMasked: existingByCustomer.cardNumberMasked,
        firstChargedAt: existingByCustomer.lastChargedAt,
        nextChargeAt: existingByCustomer.nextChargeAt,
        alreadyProcessed: true,
      }, "이미 등록된 정기 후원입니다");
    }

    /* 5. 회원 1인당 1개 활성 빌링키 검증 */
    if (memberId) {
      const [activeForMember] = await db
        .select({ id: billingKeys.id })
        .from(billingKeys)
        .where(
          and(
            eq(billingKeys.memberId, memberId),
            eq(billingKeys.isActive, true),
          ),
        )
        .limit(1);

      if (activeForMember) {
        return forbidden("이미 활성화된 정기 후원이 있습니다. 마이페이지에서 해지 후 재등록해 주세요.");
      }
    }

    /* 6. 토스 API: 빌링키 발급 */
    const authHeader = "Basic " + Buffer.from(TOSS_SECRET_KEY + ":").toString("base64");

    let billingResponse: any;
    try {
      const billingRes = await fetch(`${TOSS_API_BASE}/billing/authorizations/issue`, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          authKey: data.authKey,
          customerKey: data.customerKey,
        }),
      });
      billingResponse = await billingRes.json();

      if (!billingRes.ok) {
        console.error("[billing-confirm] 토스 빌링키 발급 실패:", billingResponse);
        await logUserAction(req, memberId, data.name, "billing_issue_failed", {
          target: data.customerKey,
          detail: {
            tossCode: billingResponse?.code,
            tossMessage: billingResponse?.message,
          },
          success: false,
        });
        return badRequest(
          billingResponse?.message || "카드 등록에 실패했습니다",
          { code: billingResponse?.code, detail: billingResponse?.message },
        );
      }
    } catch (tossErr: any) {
      console.error("[billing-confirm] 토스 빌링 네트워크 에러:", tossErr);
      return serverError("결제 시스템 통신 오류", tossErr?.message);
    }

    /* 7. 빌링키 정보 추출 */
    const billingKey: string = billingResponse.billingKey;
    const cardInfo = billingResponse.card || {};
    const cardCompany: string = cardInfo.company || cardInfo.issuerCode || "카드";
    const cardNumberMasked: string = cardInfo.number || "****-****-****-****";
    const cardType: string = cardInfo.cardType === "체크" ? "체크" : "신용";

    if (!billingKey) {
      console.error("[billing-confirm] billingKey 누락:", billingResponse);
      return serverError("빌링키 발급 응답이 비어있습니다");
    }

    /* 8. 토스 API: 빌링키로 첫 결제 호출 */
    const firstOrderId = generateTossOrderId("BILL");
    const orderName = "교사유가족협의회 정기 후원 (1회차)";

    let chargeResponse: any;
    try {
      const chargeRes = await fetch(`${TOSS_API_BASE}/billing/${encodeURIComponent(billingKey)}`, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerKey: data.customerKey,
          amount: data.amount,
          orderId: firstOrderId,
          orderName,
          customerEmail: data.email,
          customerName: data.name,
        }),
      });
      chargeResponse = await chargeRes.json();

      if (!chargeRes.ok) {
        console.error("[billing-confirm] 첫 결제 실패:", chargeResponse);
        /* 빌링키는 발급됐지만 첫 결제만 실패 — 빌링키 비활성으로 저장 */
        const failedInsertPayload: any = {
          memberId,
          billingKey,
          customerKey: data.customerKey,
          cardCompany,
          cardNumberMasked,
          cardType,
          amount: data.amount,
          isActive: false,
          consecutiveFailCount: 1,
          lastFailureReason: chargeResponse?.message || "첫 결제 실패",
          deactivatedAt: new Date(),
          deactivatedReason: "first_charge_failed",
        };
        await db.insert(billingKeys).values(failedInsertPayload).catch(() => {});

        await logUserAction(req, memberId, data.name, "billing_first_charge_failed", {
          target: data.customerKey,
          detail: {
            tossCode: chargeResponse?.code,
            tossMessage: chargeResponse?.message,
            amount: data.amount,
          },
          success: false,
        });

        return badRequest(
          chargeResponse?.message || "첫 결제에 실패했습니다",
          { code: chargeResponse?.code, detail: chargeResponse?.message },
        );
      }
    } catch (chargeErr: any) {
      console.error("[billing-confirm] 첫 결제 네트워크 에러:", chargeErr);
      return serverError("결제 시스템 통신 오류 (첫 결제)", chargeErr?.message);
    }

    const paymentKey: string = chargeResponse.paymentKey;
    const now = new Date();
    const nextCharge = calcNextChargeDate(now);

    /* 9. billingKeys INSERT */
    const billingInsertPayload: any = {
      memberId,
      billingKey,
      customerKey: data.customerKey,
      cardCompany,
      cardNumberMasked,
      cardType,
      amount: data.amount,
      isActive: true,
      nextChargeAt: nextCharge,
      lastChargedAt: now,
      consecutiveFailCount: 0,
    };

    const [insertedBilling] = await db
      .insert(billingKeys)
      .values(billingInsertPayload)
      .returning({ id: billingKeys.id });

    /* 10. donations 첫 결제 completed INSERT */
    const donationInsertPayload: any = {
      memberId,
      donorName: data.name,
      donorPhone: data.phone,
      donorEmail: data.email,
      amount: data.amount,
      type: "regular",
      payMethod: "card",
      pgProvider: "toss",
      status: "completed",
      transactionId: paymentKey,
      tossPaymentKey: paymentKey,
      tossOrderId: firstOrderId,
      billingKeyId: insertedBilling.id,
      isAnonymous: data.isAnonymous === true,
      receiptIssued: true,
      receiptIssuedAt: now,
      receiptRequested: true,
    };

    const [donation] = await db
      .insert(donations)
      .values(donationInsertPayload)
      .returning({
        id: donations.id,
        amount: donations.amount,
        donorName: donations.donorName,
        donorEmail: donations.donorEmail,
        memberId: donations.memberId,
        type: donations.type,
      });

    /* 11. 영수증 번호 생성 + 업데이트 */
    const receiptNumber = generateReceiptNumber(donation.id);
    await db
      .update(donations)
      .set({ receiptNumber } as any)
      .where(eq(donations.id, donation.id));

    /* 12. 감사 메일 발송 (실패해도 결제는 성공) */
    try {
      const tpl = tplDonationThanks({
        donorName: donation.donorName,
        amount: donation.amount,
        donationType: "regular",
        payMethod: "card",
        donationId: donation.id,
        donationDate: now,
        isMember: !!donation.memberId,
      });
      await sendEmail({
        to: donation.donorEmail || data.email,
        subject: tpl.subject,
        html: tpl.html,
      });
    } catch (mailErr) {
      console.error("[billing-confirm] 감사 메일 예외:", mailErr);
    }

    /* 13. 감사 로그 */
    await logUserAction(req, memberId, data.name, "billing_register_success", {
      target: data.customerKey,
      detail: {
        billingKeyId: insertedBilling.id,
        donationId: donation.id,
        amount: donation.amount,
        cardCompany,
        cardNumberMasked,
        nextChargeAt: nextCharge.toISOString(),
      },
    });

    /* 14. 응답 */
    const donationNo = `D-${String(donation.id).padStart(7, "0")}`;
    return ok({
      donationId: donation.id,
      donationNo,
      donorName: donation.donorName,
      amount: donation.amount,
      cardCompany,
      cardNumberMasked,
      firstChargedAt: now.toISOString(),
      nextChargeAt: nextCharge.toISOString(),
      receiptNumber,
    }, "정기 후원이 시작되었습니다");
  } catch (err) {
    console.error("[billing-confirm]", err);
    return serverError("정기 후원 등록 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/billing-confirm" };