// netlify/functions/cron-kicc-billing.ts
// R40: KICC 빌키 자동 청구 Scheduled Function — cron-toss-billing·cron-billing-monthly 통합 대체(A안)
// - 매일 새벽 KST 03:00 (UTC 18:00) 실행
// - 오늘 약정일(members.next_billing_date) 회원 자동 청구 + 실패 재시도(1일/3일) + 3회 실패 자동해지
// - 같은 회원 정기+재시도 dedup → 이중청구 방지
// - 영수증/알림 발송 (통합 디스패처)

import type { Config } from "@netlify/functions";
import { db } from "../../db";
import { members, billingKeys, donations } from "../../db/schema";
import { eq, sql } from "drizzle-orm";
import {
  chargeWithBillingKey,
  generateBillingOrderId,
  logBillingAttempt,
  logBillingResultWithRetry,
  calculateNextBillingDate,
  getCurrentYearMonth,
  type ChargeResult,
} from "../../lib/kicc";
import { safeReevaluate } from "../../lib/donor-status";
import { dispatch } from "../../lib/notify-dispatcher";
import { NotifyEvent } from "../../lib/notify-events";

export const config: Config = {
  schedule: "0 18 * * *", // UTC 18:00 = KST 03:00 (netlify.toml에도 등록 — 이중 안전)
};

interface BillingTarget {
  memberId: number;
  memberName: string;
  memberEmail: string;
  billingKeyId: number;
  billingKey: string;
  amount: number;
  billingDay: number;
  attemptNumber: number; // 1 = 정기, 2~3 = 재시도
  attemptType: "scheduled" | "retry";
  previousLogId?: number;
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

export default async (_req: Request) => {
  const startedAt = new Date();
  console.log(`[cron-kicc-billing] 시작 ${startedAt.toISOString()}`);

  try {
    if (!process.env.KICC_MALL_ID || !process.env.KICC_SECRET_KEY) {
      throw new Error("환경변수 KICC_MALL_ID/KICC_SECRET_KEY 누락");
    }

    const scheduled = await collectScheduledTargets();
    const retries = await collectRetryTargets();

    /* dedup: 같은 회원이 정기+재시도 양쪽이면 1회만 (scheduled 우선) */
    const seen = new Set<number>();
    const allTargets: BillingTarget[] = [];
    let deduped = 0;
    for (const t of [...scheduled, ...retries]) {
      if (seen.has(t.memberId)) {
        deduped++;
        continue;
      }
      seen.add(t.memberId);
      allTargets.push(t);
    }
    console.log(`[cron-kicc-billing] 정기 ${scheduled.length} + 재시도 ${retries.length} → dedup ${deduped} → 총 ${allTargets.length}`);

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
      await Promise.all(batch.map((t) => processBillingTarget(t, summary)));
      if (i + BATCH_SIZE < allTargets.length) await new Promise((r) => setTimeout(r, 200));
    }

    const completedAt = new Date();
    summary.completedAt = completedAt.toISOString();
    summary.durationMs = completedAt.getTime() - startedAt.getTime();
    console.log(`[cron-kicc-billing] 완료`, JSON.stringify(summary, null, 2));

    return new Response(JSON.stringify({ ok: true, summary }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error(`[cron-kicc-billing] 치명적 오류:`, error);
    return new Response(JSON.stringify({ ok: false, error: error?.message, stack: error?.stack }, null, 2), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

/* 1. 오늘 약정일 대상 */
async function collectScheduledTargets(): Promise<BillingTarget[]> {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const result: any = await db.execute(sql`
    SELECT m.id AS member_id, m.name AS member_name, m.email AS member_email, m.billing_day,
           bk.id AS billing_key_id, bk.billing_key, bk.amount
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
    amount: r.amount,
    billingDay: r.billing_day,
    attemptNumber: 1,
    attemptType: "scheduled" as const,
  }));
}

/* 2. 재시도 대상 (최신 실패 로그만) */
async function collectRetryTargets(): Promise<BillingTarget[]> {
  const now = new Date();
  const result: any = await db.execute(sql`
    SELECT bl.id AS log_id, bl.attempt_number, bl.amount, bl.billing_key,
           m.id AS member_id, m.name AS member_name, m.email AS member_email, m.billing_day,
           bk.id AS billing_key_id
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
        WHERE bl2.member_id = bl.member_id AND bl2.requested_at > bl.requested_at
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
    amount: r.amount,
    billingDay: r.billing_day,
    attemptNumber: r.attempt_number + 1,
    attemptType: "retry" as const,
    previousLogId: r.log_id,
  }));
}

/* 3. 개별 청구 */
async function processBillingTarget(target: BillingTarget, summary: BillingSummary): Promise<void> {
  const yearMonth = getCurrentYearMonth();
  const orderNo = generateBillingOrderId(target.memberId, yearMonth, target.attemptNumber);
  try {
    const logId = await logBillingAttempt({
      memberId: target.memberId,
      billingKey: target.billingKey,
      attemptType: target.attemptType,
      attemptNumber: target.attemptNumber,
      amount: target.amount,
      pgOrderNo: orderNo,
    });

    const result = await chargeWithBillingKey({
      billingKey: target.billingKey,
      shopOrderNo: orderNo,
      amount: target.amount,
      goodsName: `SIREN 정기후원 ${yearMonth.slice(0, 4)}년 ${yearMonth.slice(4)}월`,
      customerName: target.memberName,
      customerEmail: target.memberEmail,
    });

    if (result.success) {
      await handleSuccess(target, logId, result);
      summary.successCount++;
    } else {
      const cancelled = await handleFailure(target, logId, result);
      summary.failedCount++;
      if (cancelled) summary.autoCancelledCount++;
    }
  } catch (error: any) {
    console.error(`[cron-kicc-billing] 회원 #${target.memberId} 처리 실패:`, error);
    summary.errors.push({ memberId: target.memberId, name: target.memberName, error: error?.message || String(error) });
  }
}

/* 4. 성공 */
async function handleSuccess(target: BillingTarget, logId: number, result: ChargeResult): Promise<void> {
  const donationResult: any = await db
    .insert(donations)
    .values({
      memberId: target.memberId,
      donorName: target.memberName,
      donorEmail: target.memberEmail,
      amount: target.amount,
      type: "regular",
      payMethod: "card",
      status: "completed",
      transactionId: result.pgTid,
      pgProvider: "kicc",
      pgTid: result.pgTid,
      pgOrderNo: result.shopOrderNo,
      billingKeyId: target.billingKeyId,
      isAnonymous: false,
      receiptRequested: true,
      billingLogId: logId,
      paidAt: new Date(),
    } as any)
    .returning({ id: donations.id });
  const donationRows = Array.isArray(donationResult) ? donationResult : (donationResult as any).rows || [];
  const donationId = donationRows[0]?.id;

  await logBillingResultWithRetry(logId, result, 1, donationId);

  const nextDate = calculateNextBillingDate(target.billingDay, addDays(new Date(), 1));
  const nextDateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}-${String(nextDate.getDate()).padStart(2, "0")}`;

  await db.execute(sql`
    UPDATE members
    SET total_donation_amount = COALESCE(total_donation_amount, 0) + ${target.amount},
        next_billing_date = ${nextDateStr}::date,
        billing_retry_count = 0,
        billing_last_failed_at = NULL,
        updated_at = NOW()
    WHERE id = ${target.memberId}
  `);

  await db
    .update(billingKeys)
    .set({ lastChargedAt: new Date(), nextChargeAt: nextDate, consecutiveFailCount: 0, lastFailureReason: null } as any)
    .where(eq(billingKeys.id, target.billingKeyId));

  console.log(`[cron-kicc-billing] 성공: 회원 #${target.memberId} (${target.memberName}) — ${target.amount.toLocaleString()}원`);

  dispatch({
    event: NotifyEvent.BILLING_SUCCESS,
    target: { type: "member", id: target.memberId },
    params: {
      memberName: target.memberName,
      amount: target.amount,
      donationId,
      chargedAt: new Date(),
      nextChargeAt: nextDate,
      orderId: result.shopOrderNo,
      title: "정기 후원 결제 완료",
      message: `${target.amount.toLocaleString()}원 결제가 완료되었습니다. 다음 결제일: ${nextDateStr}`,
      link: "/mypage.html",
      category: "billing",
      severity: "info",
      refTable: "donations",
      refId: donationId,
    },
  });

  await safeReevaluate(target.memberId, "cron-kicc-billing/success");
}

/* 5. 실패 */
async function handleFailure(target: BillingTarget, logId: number, result: ChargeResult): Promise<boolean> {
  const newRetryCount = target.attemptNumber;
  const shouldCancel = newRetryCount >= 3 || !result.retryable;

  await logBillingResultWithRetry(logId, result, target.attemptNumber + 1);

  await db.execute(sql`
    UPDATE members
    SET billing_retry_count = ${newRetryCount}, billing_last_failed_at = NOW(), updated_at = NOW()
    WHERE id = ${target.memberId}
  `);

  await db
    .update(billingKeys)
    .set({ consecutiveFailCount: newRetryCount, lastFailureReason: `${result.errorCode}: ${result.errorMessage}` } as any)
    .where(eq(billingKeys.id, target.billingKeyId));

  if (shouldCancel) {
    await db
      .update(billingKeys)
      .set({ isActive: false, deactivatedAt: new Date(), deactivatedReason: `자동 해지 (${newRetryCount}회 연속 실패: ${result.errorCode})` } as any)
      .where(eq(billingKeys.id, target.billingKeyId));

    await db.execute(sql`UPDATE members SET next_billing_date = NULL, updated_at = NOW() WHERE id = ${target.memberId}`);

    console.log(`[cron-kicc-billing] 자동해지: 회원 #${target.memberId} (${target.memberName}) — ${result.errorCode}`);

    dispatch({
      event: NotifyEvent.BILLING_CANCELED,
      target: { type: "member", id: target.memberId },
      params: {
        memberName: target.memberName,
        amount: target.amount,
        canceledAt: new Date(),
        cancelReason: `${newRetryCount}회 연속 실패: ${result.errorCode}`,
        title: "정기 후원 자동 해지 안내",
        message: `결제 실패가 ${newRetryCount}회 누적되어 정기 후원이 자동 해지되었습니다.`,
        emailBody: `정기 후원이 자동 해지되었습니다.<br/>사유: ${newRetryCount}회 연속 실패 (${result.errorCode})<br/><br/>재구독을 원하시면 마이페이지에서 다시 신청하실 수 있습니다.`,
        link: "/mypage.html",
        category: "billing",
        severity: "warning",
      },
    });

    await safeReevaluate(target.memberId, "cron-kicc-billing/auto-cancel");
    return true;
  } else {
    const nextRetry = target.attemptNumber === 1 ? addDays(new Date(), 1) : addDays(new Date(), 3);
    const nextRetryStr = `${nextRetry.getFullYear()}-${String(nextRetry.getMonth() + 1).padStart(2, "0")}-${String(nextRetry.getDate()).padStart(2, "0")}`;

    /* R41 Q1-001 FIX: 재시도일을 next_billing_date에 쓰지 않는다 (이전엔 여기서 덮어썼음).
       덮으면 다음날 collectScheduledTargets가 이 회원을 '정기(attempt 1)'로 재포착하고
       dedup이 retry(attempt 2)를 버려 → 시도횟수가 영원히 1에 고정 → 1/3일 에스컬레이션·
       3회 자동해지가 작동 안 함(무한 일일 재청구). 재시도는 billing_logs.next_retry_at +
       collectRetryTargets 경로로만 처리한다. next_billing_date는 성공 시(다음달)·자동해지 시(NULL)에만 변경.
       (billing_retry_count·billing_last_failed_at은 위 분기 이전 UPDATE에서 이미 갱신됨) */

    console.log(`[cron-kicc-billing] 실패: 회원 #${target.memberId} (${target.memberName}) — ${result.errorCode} (재시도 ${nextRetryStr})`);

    dispatch({
      event: NotifyEvent.BILLING_FAILED,
      target: { type: "member", id: target.memberId },
      params: {
        memberName: target.memberName,
        amount: target.amount,
        failureReason: result.errorMessage || result.errorCode || "결제 실패",
        consecutiveFailCount: newRetryCount,
        willRetryAt: nextRetry,
        title: "정기 후원 결제 실패",
        message: `${target.amount.toLocaleString()}원 결제가 실패했습니다. 재시도 예정: ${nextRetryStr}`,
        link: "/mypage.html",
        category: "billing",
        severity: "warning",
        refTable: "billing_logs",
        refId: logId,
      },
    });
    return false;
  }
}

function addDays(date: Date, days: number): Date {
  const r = new Date(date);
  r.setDate(r.getDate() + days);
  return r;
}
