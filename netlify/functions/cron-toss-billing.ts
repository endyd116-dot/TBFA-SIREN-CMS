// netlify/functions/cron-toss-billing.ts
// ★ Phase 2 Step 3: 토스 빌링 자동 청구 Scheduled Function
// - 매일 자정 KST (UTC 15:00) 실행
// - 오늘 약정일 회원 자동 청구
// - 실패 재시도 (1일 후 / 3일 후)
// - 3회 연속 실패 시 자동 해지
// - 영수증/알림 발송 (Phase 8에서 실제 연결)

import type { Config } from "@netlify/functions";
import { db } from "../../db";
import {
  members,
  billingKeys,
  billingLogs,
  donations,
  type NewDonation,
} from "../../db/schema";
import { eq, and, sql, lte, isNull } from "drizzle-orm";
import {
  chargeWithBillingKey,
  generateBillingOrderId,
  logBillingAttempt,
  logBillingResultWithRetry,
  calculateNextBillingDate,
  getCurrentYearMonth,
  type ChargeResult,
} from "../../lib/toss-billing";
// ★ Phase 2 (마일스톤 #16 단계 C): donor_type 재평가 후크
import { safeReevaluate } from "../../lib/donor-status";
// ★ Phase 8: 통합 알림 디스패처
import { dispatch } from "../../lib/notify-dispatcher";
import { NotifyEvent } from "../../lib/notify-events";

export const config: Config = {
  schedule: "0 15 * * *",  // UTC 15:00 = KST 00:00
};

/* =========================================================
   타입
   ========================================================= */

interface BillingTarget {
  memberId: number;
  memberName: string;
  memberEmail: string;
  billingKeyId: number;
  billingKey: string;
  customerKey: string;
  amount: number;
  billingDay: number;
  attemptNumber: number;  // 1 = 정기, 2~3 = 재시도
  attemptType: "scheduled" | "retry";
  previousLogId?: number;  // 재시도 시 이전 로그 ID
}

interface BillingSummary {
  totalTargets: number;
  successCount: number;
  failedCount: number;
  autoCancelledCount: number;
  errors: Array<{ memberId: number; name: string; error: string }>;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

/* =========================================================
   메인 핸들러
   ========================================================= */

export default async (_req: Request) => {
  const startedAt = new Date();
  console.log(`[cron-billing] 시작 ${startedAt.toISOString()}`);

  try {
    // 환경변수 검증
    const mode = process.env.TOSS_MODE || "test";
    const secretKeyEnv = mode === "live" ? "TOSS_LIVE_SECRET_KEY" : "TOSS_TEST_SECRET_KEY";
    if (!process.env[secretKeyEnv]) {
      throw new Error(`환경변수 ${secretKeyEnv} 누락`);
    }

    // 1. 청구 대상자 수집
    const scheduled = await collectScheduledTargets();
    const retries = await collectRetryTargets();

    // ★ 중복 제거: 같은 회원이 scheduled(오늘 약정일) + retries(이전 실패 재시도)
    //   양쪽에 동시에 들어있으면 1회만 청구. scheduled 우선(오늘이 정기일이므로
    //   이번 사이클에서 정기 청구로 처리하고, 또 실패하면 다음 cron의 retry로 잡힘).
    //   이 dedup이 없으면 같은 회원에게 같은 알림이 2번 발송됨.
    const seenMemberIds = new Set<number>();
    const allTargets: BillingTarget[] = [];
    let dedupedCount = 0;
    for (const t of [...scheduled, ...retries]) {
      if (seenMemberIds.has(t.memberId)) { dedupedCount++; continue; }
      seenMemberIds.add(t.memberId);
      allTargets.push(t);
    }

    console.log(`[cron-billing] 대상: 정기 ${scheduled.length}명 + 재시도 ${retries.length}명 → dedup ${dedupedCount}건 제외 → 총 ${allTargets.length}명`);

    // 2. 배치 실행 (5명씩)
    const summary: BillingSummary = {
      totalTargets: allTargets.length,
      successCount: 0,
      failedCount: 0,
      autoCancelledCount: 0,
      errors: [],
      startedAt: startedAt.toISOString(),
      completedAt: "",
      durationMs: 0,
    };

    const BATCH_SIZE = 5;
    for (let i = 0; i < allTargets.length; i += BATCH_SIZE) {
      const batch = allTargets.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(target => processBillingTarget(target, summary))
      );
      // 배치 간 200ms 딜레이 (rate limit 방어)
      if (i + BATCH_SIZE < allTargets.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    const completedAt = new Date();
    summary.completedAt = completedAt.toISOString();
    summary.durationMs = completedAt.getTime() - startedAt.getTime();

    console.log(`[cron-billing] 완료`, JSON.stringify(summary, null, 2));

    return new Response(
      JSON.stringify({ ok: true, summary }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error(`[cron-billing] 치명적 오류:`, error);
    return new Response(
      JSON.stringify({ ok: false, error: error?.message, stack: error?.stack }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

/* =========================================================
   1. 오늘 청구 대상자 조회
   ========================================================= */

async function collectScheduledTargets(): Promise<BillingTarget[]> {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const result: any = await db.execute(sql`
    SELECT
      m.id AS member_id,
      m.name AS member_name,
      m.email AS member_email,
      m.billing_day,
      bk.id AS billing_key_id,
      bk.billing_key,
      bk.customer_key,
      bk.amount
    FROM members m
    INNER JOIN billing_keys bk ON bk.member_id = m.id
    WHERE m.next_billing_date = ${todayStr}::date
      AND bk.is_active = true
      AND m.withdrawn_at IS NULL
      AND m.status = 'active'
  `);

  const rows = Array.isArray(result) ? result : (result as any).rows || [];
  return rows.map((r: any) => ({
    memberId: r.member_id,
    memberName: r.member_name,
    memberEmail: r.member_email,
    billingKeyId: r.billing_key_id,
    billingKey: r.billing_key,
    customerKey: r.customer_key,
    amount: r.amount,
    billingDay: r.billing_day,
    attemptNumber: 1,
    attemptType: "scheduled" as const,
  }));
}

/* =========================================================
   2. 재시도 대상자 조회
   ========================================================= */

async function collectRetryTargets(): Promise<BillingTarget[]> {
  const now = new Date();

  // next_retry_at <= 지금 + 같은 회원의 최신 실패 로그만
  const result: any = await db.execute(sql`
    SELECT
      bl.id AS log_id,
      bl.attempt_number,
      bl.amount,
      bl.billing_key,
      m.id AS member_id,
      m.name AS member_name,
      m.email AS member_email,
      m.billing_day,
      bk.id AS billing_key_id,
      bk.customer_key
    FROM billing_logs bl
    INNER JOIN members m ON m.id = bl.member_id
    INNER JOIN billing_keys bk ON bk.member_id = m.id AND bk.is_active = true
    WHERE bl.next_retry_at <= ${now.toISOString()}::timestamp
      AND bl.status = 'failed'
      AND bl.attempt_number < 3
      AND m.withdrawn_at IS NULL
      AND m.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM billing_logs bl2
        WHERE bl2.member_id = bl.member_id
          AND bl2.requested_at > bl.requested_at
      )
    ORDER BY bl.next_retry_at ASC
  `);

  const rows = Array.isArray(result) ? result : (result as any).rows || [];
  return rows.map((r: any) => ({
    memberId: r.member_id,
    memberName: r.member_name,
    memberEmail: r.member_email,
    billingKeyId: r.billing_key_id,
    billingKey: r.billing_key,
    customerKey: r.customer_key,
    amount: r.amount,
    billingDay: r.billing_day,
    attemptNumber: r.attempt_number + 1,  // 다음 차수
    attemptType: "retry" as const,
    previousLogId: r.log_id,
  }));
}

/* =========================================================
   3. 빌링 실행 (개별 회원)
   ========================================================= */

async function processBillingTarget(
  target: BillingTarget,
  summary: BillingSummary
): Promise<void> {
  const yearMonth = getCurrentYearMonth();
  const orderId = generateBillingOrderId(target.memberId, yearMonth, target.attemptNumber);

  try {
    // Step A: 시도 로그 기록 (pending)
    const logId = await logBillingAttempt({
      memberId: target.memberId,
      billingKey: target.billingKey,
      attemptType: target.attemptType,
      attemptNumber: target.attemptNumber,
      amount: target.amount,
      tossOrderId: orderId,
    });

    // Step B: 토스 API 호출
    const orderName = `SIREN 정기후원 ${yearMonth.slice(0, 4)}년 ${yearMonth.slice(4)}월`;
    const result = await chargeWithBillingKey({
      billingKey: target.billingKey,
      customerKey: target.customerKey,
      amount: target.amount,
      orderId: orderId,
      orderName: orderName,
      customerEmail: target.memberEmail,
      customerName: target.memberName,
    });

    // Step C: 결과 처리
    if (result.success) {
      await handleSuccess(target, logId, result);
      summary.successCount++;
    } else {
      const cancelled = await handleFailure(target, logId, result);
      summary.failedCount++;
      if (cancelled) summary.autoCancelledCount++;
    }
  } catch (error: any) {
    console.error(`[cron-billing] 회원 #${target.memberId} 처리 실패:`, error);
    summary.errors.push({
      memberId: target.memberId,
      name: target.memberName,
      error: error?.message || String(error),
    });
  }
}

/* =========================================================
   4. 성공 처리
   ========================================================= */

async function handleSuccess(
  target: BillingTarget,
  logId: number,
  result: ChargeResult
): Promise<void> {
  // 4-1. donations INSERT
  const donationResult: any = await db.insert(donations).values({
    memberId: target.memberId,
    donorName: target.memberName,
    donorEmail: target.memberEmail,
    amount: target.amount,
    type: "regular",
    payMethod: "card",
    status: "completed",
    transactionId: result.paymentKey,
    pgProvider: "toss",
    tossPaymentKey: result.paymentKey,
    tossOrderId: result.orderId,
    billingKeyId: target.billingKeyId,
    isAnonymous: false,
    receiptRequested: true,
    billingLogId: logId,
  } as any).returning({ id: donations.id });
  const donationRows = Array.isArray(donationResult) ? donationResult : (donationResult as any).rows || [];
  const donationId = donationRows[0]?.id;

  // 4-2. billing_logs 업데이트 (성공)
  await logBillingResultWithRetry(logId, result, 1, donationId);

  // 4-3. members 통계 갱신 + 다음 청구일 계산
  const nextDate = calculateNextBillingDate(
    target.billingDay,
    addDays(new Date(), 1)  // 내일 이후 첫 번째 약정일
  );
  const nextDateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;

  await db.execute(sql`
    UPDATE members
    SET total_donation_amount = COALESCE(total_donation_amount, 0) + ${target.amount},
        next_billing_date = ${nextDateStr}::date,
        billing_retry_count = 0,
        billing_last_failed_at = NULL,
        updated_at = NOW()
    WHERE id = ${target.memberId}
  `);

  // 4-4. billing_keys 통계 갱신
  await db.update(billingKeys)
    .set({
      lastChargedAt: new Date(),
      consecutiveFailCount: 0,
      lastFailureReason: null,
    } as any)
    .where(eq(billingKeys.id, target.billingKeyId));

  console.log(`[cron-billing] ✅ 성공: 회원 #${target.memberId} (${target.memberName}) — ${target.amount.toLocaleString()}원`);

  // 4-5. 영수증/알림 발송 (Phase 8 — 통합 디스패처)
  dispatch({
    event: NotifyEvent.BILLING_SUCCESS,
    target: { type: "member", id: target.memberId },
    params: {
      memberName:   target.memberName,
      amount:       target.amount,
      donationId,
      chargedAt:    new Date(),
      nextChargeAt: nextDate,
      orderId:      result.orderId,
      title:        "정기 후원 결제 완료",
      message:      `${target.amount.toLocaleString()}원 결제가 완료되었습니다. 다음 결제일: ${nextDateStr}`,
      link:         "/mypage.html",
      category:     "billing",
      severity:     "info",
      refTable:     "donations",
      refId:        donationId,
    },
  });

  // ★ Phase 2 단계 C: donor_type 재평가 (fire-and-forget)
  // 정기 결제 성공 → channel='toss' 유지 보장
  await safeReevaluate(target.memberId, "cron-toss-billing/success");
}

/* =========================================================
   5. 실패 처리
   ========================================================= */

async function handleFailure(
  target: BillingTarget,
  logId: number,
  result: ChargeResult
): Promise<boolean> {
  const newRetryCount = target.attemptNumber;
  const shouldCancel = newRetryCount >= 3 || !result.retryable;

  // 5-1. billing_logs 업데이트 (실패 + 다음 재시도 시점)
  await logBillingResultWithRetry(logId, result, target.attemptNumber + 1);

  // 5-2. members 실패 카운트 증가
  await db.execute(sql`
    UPDATE members
    SET billing_retry_count = ${newRetryCount},
        billing_last_failed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${target.memberId}
  `);

  // 5-3. billing_keys 실패 카운트 증가
  await db.update(billingKeys)
    .set({
      consecutiveFailCount: newRetryCount,
      lastFailureReason: `${result.errorCode}: ${result.errorMessage}`,
    } as any)
    .where(eq(billingKeys.id, target.billingKeyId));

  if (shouldCancel) {
    // 5-4-A. 자동 해지
    await db.update(billingKeys)
      .set({
        isActive: false,
        deactivatedAt: new Date(),
        deactivatedReason: `자동 해지 (${newRetryCount}회 연속 실패: ${result.errorCode})`,
      } as any)
      .where(eq(billingKeys.id, target.billingKeyId));

    // next_billing_date 비우기
    await db.execute(sql`
      UPDATE members
      SET next_billing_date = NULL,
          updated_at = NOW()
      WHERE id = ${target.memberId}
    `);

    console.log(`[cron-billing] ⛔ 자동해지: 회원 #${target.memberId} (${target.memberName}) — ${result.errorCode}`);

    // 5-4-B. 해지 알림 (Phase 8 — 통합 디스패처)
    dispatch({
      event: NotifyEvent.BILLING_CANCELED,
      target: { type: "member", id: target.memberId },
      params: {
        memberName:    target.memberName,
        amount:        target.amount,
        canceledAt:    new Date(),
        cancelReason:  `${newRetryCount}회 연속 실패: ${result.errorCode}`,
        title:         "정기 후원 자동 해지 안내",
        message:       `결제 실패가 ${newRetryCount}회 누적되어 정기 후원이 자동 해지되었습니다.`,
        emailBody:     `정기 후원이 자동 해지되었습니다.<br/>사유: ${newRetryCount}회 연속 실패 (${result.errorCode})<br/><br/>재구독을 원하시면 마이페이지에서 다시 신청하실 수 있습니다.`,
        link:          "/mypage.html",
        category:      "billing",
        severity:      "warning",
      },
    });

    // ★ Phase 2 단계 C: 자동 해지 → donor_type 재평가
    // (다른 채널 없으면 prospect/cancelled로 강등)
    await safeReevaluate(target.memberId, "cron-toss-billing/auto-cancel");

    return true;
  } else {
    // 5-5. next_billing_date를 재시도 시점으로 조정
    const nextRetry = target.attemptNumber === 1
      ? addDays(new Date(), 1)  // 1차 실패 → 내일
      : addDays(new Date(), 3); // 2차 실패 → 3일 후
    const nextRetryStr = `${nextRetry.getFullYear()}-${String(nextRetry.getMonth() + 1).padStart(2, '0')}-${String(nextRetry.getDate()).padStart(2, '0')}`;

    await db.execute(sql`
      UPDATE members
      SET next_billing_date = ${nextRetryStr}::date,
          updated_at = NOW()
      WHERE id = ${target.memberId}
    `);

    console.log(`[cron-billing] ⚠️ 실패: 회원 #${target.memberId} (${target.memberName}) — ${result.errorCode} (재시도 ${nextRetryStr})`);

    // 5-6. 실패 알림 (Phase 8 — 통합 디스패처)
    dispatch({
      event: NotifyEvent.BILLING_FAILED,
      target: { type: "member", id: target.memberId },
      params: {
        memberName:           target.memberName,
        amount:                target.amount,
        failureReason:         result.errorMessage || result.errorCode || "결제 실패",
        consecutiveFailCount:  newRetryCount,
        willRetryAt:           nextRetry,
        title:                 "정기 후원 결제 실패",
        message:               `${target.amount.toLocaleString()}원 결제가 실패했습니다. 재시도 예정: ${nextRetryStr}`,
        link:                  "/mypage.html",
        category:              "billing",
        severity:              "warning",
        refTable:              "billing_logs",
        refId:                 logId,
      },
    });

    return false;
  }
}

/* =========================================================
   헬퍼
   ========================================================= */

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
