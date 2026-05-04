/**
 * Scheduled Function: 매월 정기 결제 cron
 *
 * - 매일 새벽 03:00 KST (UTC 18:00) 실행
 * - 오늘이 nextChargeAt인 활성 빌링키 조회
 * - 각 빌링키별로 토스 API 결제 호출
 * - 성공: DB 업데이트 + 영수증 + 감사 메일
 * - 실패: consecutiveFailCount++ + 알림 메일
 *   * 1회 실패: 3일 후 재시도
 *   * 2회 실패: 5일 후 재시도 + 경고 메일
 *   * 3회 실패: 자동 해지 + 해지 안내 메일
 *
 * 보안:
 * - 외부 호출 차단 (Scheduled Function만 호출)
 * - 토스 시크릿 키는 서버 측만 사용
 * - 회원이 탈퇴/정지되면 자동 비활성
 */
import { eq, and, lte, isNotNull } from "drizzle-orm";
import crypto from "crypto";
import { db, billingKeys, donations, members } from "../../db";
import { sendEmail, tplBillingChargeSuccess, tplBillingChargeFailed } from "../../lib/email";
import { logAudit } from "../../lib/audit";

const TOSS_MODE = (process.env.TOSS_MODE || "test").toLowerCase();
const TOSS_SECRET_KEY =
  TOSS_MODE === "live"
    ? (process.env.TOSS_LIVE_SECRET_KEY || "")
    : (process.env.TOSS_TEST_SECRET_KEY || "");

const TOSS_API_BASE = "https://api.tosspayments.com/v1";

/* 재시도 정책 */
const RETRY_DELAYS = [3, 5, 0]; // 1회 실패: 3일 후 / 2회: 5일 후 / 3회: 자동해지
const MAX_FAIL_COUNT = 3;

function generateOrderId(billingKeyId: number): string {
  const now = new Date();
  const ym = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const rand = crypto.randomBytes(3).toString("hex");
  return `BILL-${ym}${day}-BK${billingKeyId}-${rand}`;
}

function generateReceiptNumber(donationId: number): string {
  const year = new Date().getFullYear();
  return `TBFA-${year}-${String(donationId).padStart(6, "0")}`;
}

function calcNextChargeDate(from: Date, monthsAhead = 1): Date {
  const next = new Date(from);
  next.setMonth(next.getMonth() + monthsAhead);
  return next;
}

function calcRetryDate(from: Date, daysAhead: number): Date {
  const next = new Date(from);
  next.setDate(next.getDate() + daysAhead);
  return next;
}

/* ───────── 단건 결제 처리 ───────── */
async function processOneCharge(billing: any, authHeader: string): Promise<{
  success: boolean;
  reason?: string;
  donationId?: number;
}> {
  const orderId = generateOrderId(billing.id);
  const orderName = "교사유가족협의회 정기 후원";

  /* 회원 정보 조회 (메일 발송용) */
  let donorName = "후원자";
  let donorEmail: string | null = null;
  let donorPhone: string | null = null;
  let memberStatus: string | null = null;

  if (billing.memberId) {
    const [member] = await db
      .select({
        name: members.name,
        email: members.email,
        phone: members.phone,
        status: members.status,
      })
      .from(members)
      .where(eq(members.id, billing.memberId))
      .limit(1);

    if (member) {
      donorName = member.name;
      donorEmail = member.email;
      donorPhone = member.phone;
      memberStatus = member.status;
    }
  }

  /* 회원이 탈퇴/정지면 빌링키 자동 비활성 */
  if (memberStatus === "withdrawn" || memberStatus === "suspended") {
    await db
      .update(billingKeys)
      .set({
        isActive: false,
        deactivatedAt: new Date(),
        deactivatedReason: `member_${memberStatus}`,
        nextChargeAt: null,
      } as any)
      .where(eq(billingKeys.id, billing.id));

    await logAudit({
      userId: billing.memberId,
      userType: "system",
      userName: donorName,
      action: "billing_auto_deactivated",
      target: `BK-${billing.id}`,
      detail: { reason: `member_${memberStatus}` },
    });

    return { success: false, reason: `member_${memberStatus}` };
  }

  /* 토스 결제 호출 */
  let chargeResponse: any;
  try {
    const chargeRes = await fetch(`${TOSS_API_BASE}/billing/${encodeURIComponent(billing.billingKey)}`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customerKey: billing.customerKey,
        amount: billing.amount,
        orderId,
        orderName,
        customerEmail: donorEmail || "noreply@siren-org.kr",
        customerName: donorName,
      }),
    });
    chargeResponse = await chargeRes.json();

    if (!chargeRes.ok) {
      console.error(`[cron-billing] BK-${billing.id} 결제 실패:`, chargeResponse);

      /* 실패 카운트 증가 + 다음 재시도 스케줄링 */
      const newFailCount = (billing.consecutiveFailCount || 0) + 1;
      const isFinal = newFailCount >= MAX_FAIL_COUNT;
      const now = new Date();

      let nextChargeAt: Date | null = null;
      let isActive = true;
      let deactivatedReason: string | null = null;

      if (isFinal) {
        /* 자동 해지 */
        isActive = false;
        deactivatedReason = "too_many_fails";
        nextChargeAt = null;
      } else {
        /* 재시도 일정 */
        const delayDays = RETRY_DELAYS[newFailCount - 1] || 3;
        nextChargeAt = calcRetryDate(now, delayDays);
      }

      const updatePayload: any = {
        consecutiveFailCount: newFailCount,
        lastFailureReason: (chargeResponse?.message || "결제 거절").slice(0, 500),
        nextChargeAt,
        isActive,
        updatedAt: now,
      };
      if (deactivatedReason) {
        updatePayload.deactivatedAt = now;
        updatePayload.deactivatedReason = deactivatedReason;
      }

      await db.update(billingKeys).set(updatePayload).where(eq(billingKeys.id, billing.id));

      /* failed donation 기록 */
      await db.insert(donations).values({
        memberId: billing.memberId,
        donorName,
        donorPhone,
        donorEmail,
        amount: billing.amount,
        type: "regular",
        payMethod: "card",
        pgProvider: "toss",
        status: "failed",
        billingKeyId: billing.id,
        tossOrderId: orderId,
        failureReason: chargeResponse?.message?.slice(0, 500) || "결제 거절",
      } as any);

      /* 알림 메일 발송 */
      if (donorEmail) {
        try {
          const tpl = tplBillingChargeFailed({
            donorName,
            amount: billing.amount,
            failureReason: chargeResponse?.message || "카드 결제가 거절되었습니다",
            consecutiveFailCount: newFailCount,
            willRetryAt: isFinal ? undefined : (nextChargeAt || undefined),
            isMember: !!billing.memberId,
          });
          await sendEmail({
            to: donorEmail,
            subject: tpl.subject,
            html: tpl.html,
          });
        } catch (mailErr) {
          console.error(`[cron-billing] BK-${billing.id} 실패 메일 예외:`, mailErr);
        }
      }

      await logAudit({
        userId: billing.memberId,
        userType: "system",
        userName: donorName,
        action: isFinal ? "billing_auto_deactivated" : "billing_charge_failed",
        target: `BK-${billing.id}`,
        detail: {
          amount: billing.amount,
          consecutiveFailCount: newFailCount,
          tossCode: chargeResponse?.code,
          tossMessage: chargeResponse?.message,
          orderId,
        },
        success: false,
      });

      return { success: false, reason: chargeResponse?.message || "결제 거절" };
    }
  } catch (tossErr: any) {
    console.error(`[cron-billing] BK-${billing.id} 네트워크 에러:`, tossErr);
    /* 네트워크 에러는 카운트 증가시키지 않고 다음날 재시도 */
    const tomorrow = calcRetryDate(new Date(), 1);
    await db
      .update(billingKeys)
      .set({
        nextChargeAt: tomorrow,
        lastFailureReason: `network_error: ${tossErr?.message?.slice(0, 200)}`,
      } as any)
      .where(eq(billingKeys.id, billing.id));

    return { success: false, reason: "network_error" };
  }

  /* 결제 성공 */
  const paymentKey: string = chargeResponse.paymentKey;
  const now = new Date();
  const nextCharge = calcNextChargeDate(now, 1);

  /* donations completed INSERT */
  const [donation] = await db
    .insert(donations)
    .values({
      memberId: billing.memberId,
      donorName,
      donorPhone,
      donorEmail,
      amount: billing.amount,
      type: "regular",
      payMethod: "card",
      pgProvider: "toss",
      status: "completed",
      transactionId: paymentKey,
      tossPaymentKey: paymentKey,
      tossOrderId: orderId,
      billingKeyId: billing.id,
      receiptIssued: true,
      receiptIssuedAt: now,
      receiptRequested: true,
      isAnonymous: false,
    } as any)
    .returning({ id: donations.id });

  /* 영수증 번호 발급 */
  const receiptNumber = generateReceiptNumber(donation.id);
  await db
    .update(donations)
    .set({ receiptNumber } as any)
    .where(eq(donations.id, donation.id));

  /* billingKeys 갱신 */
  await db
    .update(billingKeys)
    .set({
      lastChargedAt: now,
      nextChargeAt: nextCharge,
      consecutiveFailCount: 0,
      lastFailureReason: null,
      updatedAt: now,
    } as any)
    .where(eq(billingKeys.id, billing.id));

  /* 성공 메일 발송 */
  if (donorEmail) {
    try {
      const tpl = tplBillingChargeSuccess({
        donorName,
        amount: billing.amount,
        donationId: donation.id,
        chargedAt: now,
        nextChargeAt: nextCharge,
        cardCompany: billing.cardCompany || "카드",
        cardNumberMasked: billing.cardNumberMasked || "****-****-****-****",
        isMember: !!billing.memberId,
      });
      await sendEmail({
        to: donorEmail,
        subject: tpl.subject,
        html: tpl.html,
      });
    } catch (mailErr) {
      console.error(`[cron-billing] BK-${billing.id} 성공 메일 예외:`, mailErr);
    }
  }

// netlify/functions/cron-billing-monthly.ts — processOneCharge 함수, audit 다음
  await logAudit({
    userId: billing.memberId,
    userType: "system",
    userName: donorName,
    action: "billing_charge_success",
    target: `BK-${billing.id}`,
    detail: {
      donationId: donation.id,
      amount: billing.amount,
      receiptNumber,
      nextChargeAt: nextCharge.toISOString(),
    },
  });

  /* ★ M-19-4: 정기 결제 성공 시 등급 자동 재산정 */
  if (billing.memberId) {
    try {
      const { refreshTierAfterDonation } = await import("../../lib/member-tier");
      refreshTierAfterDonation(billing.memberId).catch(() => {});
    } catch (_) {}
  }

  return { success: true, donationId: donation.id };
}

/* ───────── 메인 핸들러 ───────── */
export default async (req: Request) => {
  try {
    if (!TOSS_SECRET_KEY) {
      console.error("[cron-billing] TOSS_SECRET_KEY 미설정");
      return new Response(JSON.stringify({ ok: false, error: "TOSS_SECRET_KEY not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const startTime = Date.now();
    const today = new Date();

    /* 오늘 결제 대상 조회 (nextChargeAt <= 오늘 + 활성) */
    const targets = await db
      .select()
      .from(billingKeys)
      .where(
        and(
          eq(billingKeys.isActive, true),
          isNotNull(billingKeys.nextChargeAt),
          lte(billingKeys.nextChargeAt, today),
        ),
      );

    console.log(`[cron-billing] 오늘 결제 대상: ${targets.length}건`);

    if (targets.length === 0) {
      return new Response(JSON.stringify({
        ok: true,
        message: "오늘 결제 대상 없음",
        processed: 0,
        durationMs: Date.now() - startTime,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const authHeader = "Basic " + Buffer.from(TOSS_SECRET_KEY + ":").toString("base64");

    let successCount = 0;
    let failCount = 0;
    const failures: any[] = [];

    /* 순차 처리 (병렬 X — 토스 API rate limit 보호) */
    for (const billing of targets) {
      try {
        const result = await processOneCharge(billing, authHeader);
        if (result.success) {
          successCount++;
        } else {
          failCount++;
          failures.push({
            billingKeyId: billing.id,
            memberId: billing.memberId,
            amount: billing.amount,
            reason: result.reason,
          });
        }

        /* 토스 API rate limit 보호: 각 결제 사이 200ms 대기 */
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err: any) {
        console.error(`[cron-billing] BK-${billing.id} 처리 예외:`, err);
        failCount++;
        failures.push({
          billingKeyId: billing.id,
          error: err?.message,
        });
      }
    }

    const durationMs = Date.now() - startTime;
    const summary = {
      ok: true,
      total: targets.length,
      success: successCount,
      failed: failCount,
      durationMs,
      timestamp: today.toISOString(),
    };

    console.log("[cron-billing] 완료:", summary);

    /* 실행 결과 audit_logs 기록 */
    await logAudit({
      userType: "system",
      userName: "cron-billing-monthly",
      action: "cron_billing_monthly_complete",
      target: today.toISOString().slice(0, 10),
      detail: {
        ...summary,
        failures: failures.slice(0, 50), // 최대 50건만 기록
      },
    });

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[cron-billing] 전체 실패:", err);
    return new Response(JSON.stringify({
      ok: false,
      error: err?.message || "cron 실행 중 오류",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

/* ───────── Scheduled Function 설정 ─────────
   매일 새벽 3시 KST = UTC 18:00 (전날) */
export const config = {
  schedule: "0 18 * * *",  // UTC 18:00 = KST 03:00
};