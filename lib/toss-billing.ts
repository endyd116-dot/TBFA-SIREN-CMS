// lib/toss-billing.ts
// ★ Phase 2 Step 2: 토스 빌링 API 호출 라이브러리
// - 빌링키로 자동 결제
// - orderId 멱등성 보장
// - 에러 정규화 + 재시도 스케줄
// - BillingLog 통합 기록

import { db } from "../db";
import { billingLogs, type NewBillingLog } from "../db/schema";
import { eq } from "drizzle-orm";

/* =========================================================
   타입 정의
   ========================================================= */

export interface ChargeParams {
  billingKey: string;
  customerKey: string;
  amount: number;
  orderId: string;
  orderName: string;
  customerEmail?: string;
  customerName?: string;
}

export interface ChargeResult {
  success: boolean;
  paymentKey?: string;
  orderId?: string;
  approvedAt?: string;
  receiptUrl?: string;
  // 실패 시
  errorCode?: string;
  errorMessage?: string;
  errorCategory?: ErrorCategory;
  retryable?: boolean;
  rawResponse?: any;
}

export type ErrorCategory =
  | "card_invalid"
  | "insufficient_funds"
  | "declined"
  | "network"
  | "rate_limit"
  | "unknown";

export interface LogParams {
  memberId: number;
  billingKey: string;
  attemptType: "scheduled" | "retry" | "manual";
  attemptNumber: number;
  amount: number;
  tossOrderId: string;
}

/* =========================================================
   환경 설정
   ========================================================= */

function getTossBaseUrl(): string {
  const mode = process.env.TOSS_MODE || "test";
  return mode === "live"
    ? "https://api.tosspayments.com"
    : "https://api.tosspayments.com"; // 토스는 test/live 동일 URL (키만 다름)
}

function getTossSecretKey(): string {
  const mode = process.env.TOSS_MODE || "test";
  const key = mode === "live"
    ? process.env.TOSS_LIVE_SECRET_KEY
    : process.env.TOSS_TEST_SECRET_KEY;
  if (!key) {
    throw new Error(`[toss-billing] TOSS_${mode.toUpperCase()}_SECRET_KEY 환경변수 누락`);
  }
  return key;
}

function getAuthHeader(): string {
  const secretKey = getTossSecretKey();
  // 토스 인증: Basic {secretKey:}의 base64
  const encoded = Buffer.from(`${secretKey}:`).toString("base64");
  return `Basic ${encoded}`;
}

/* =========================================================
   orderId 생성 — 멱등성 보장
   ========================================================= */

/**
 * 동일 회원 + 동일 월은 동일한 orderId 생성
 * → 토스가 중복 요청을 거부 → 이중 결제 방지
 *
 * 형식: SIREN-BILL-{yearMonth}-{memberId}-{timestamp}
 * 예: SIREN-BILL-202611-123-1730000000
 *
 * @param memberId 회원 ID
 * @param yearMonth "YYYYMM" 형식 (예: "202611")
 * @param retryNumber 재시도 차수 (1, 2, 3) — 차수별로 다른 orderId 필요
 */
export function generateBillingOrderId(
  memberId: number,
  yearMonth: string,
  retryNumber: number = 1
): string {
  const prefix = "SIREN-BILL";
  // retryNumber가 1이면 base orderId, 2~3이면 -r2, -r3 접미사
  const suffix = retryNumber > 1 ? `-r${retryNumber}` : "";
  return `${prefix}-${yearMonth}-${memberId}${suffix}`;
}

/* =========================================================
   에러 정규화
   ========================================================= */

const TOSS_ERROR_MAP: Record<string, { category: ErrorCategory; retryable: boolean }> = {
  INVALID_CARD: { category: "card_invalid", retryable: false },
  EXPIRED_CARD: { category: "card_invalid", retryable: false },
  INVALID_CARD_NUMBER: { category: "card_invalid", retryable: false },
  INVALID_CARD_EXPIRATION: { category: "card_invalid", retryable: false },
  INVALID_CARD_PASSWORD: { category: "card_invalid", retryable: false },
  INVALID_CARD_IDENTITY: { category: "card_invalid", retryable: false },

  INSUFFICIENT_BALANCE: { category: "insufficient_funds", retryable: true },
  EXCEED_MAX_DAILY_AMOUNT: { category: "insufficient_funds", retryable: true },
  EXCEED_MAX_MONTHLY_AMOUNT: { category: "insufficient_funds", retryable: true },
  EXCEED_MAX_PAYMENT_AMOUNT: { category: "insufficient_funds", retryable: true },
  OVER_LIMIT_AMOUNT: { category: "insufficient_funds", retryable: true },

  CARD_COMPANY_DECLINED: { category: "declined", retryable: true },
  DECLINED_BY_CARD_COMPANY: { category: "declined", retryable: true },
  CARD_PROCESSING_ERROR: { category: "declined", retryable: true },
  NOT_ALLOWED_CARD_COMPANY: { category: "declined", retryable: false },

  NETWORK_ERROR: { category: "network", retryable: true },
  TIMEOUT: { category: "network", retryable: true },
  GATEWAY_TIMEOUT: { category: "network", retryable: true },

  TOO_MANY_REQUESTS: { category: "rate_limit", retryable: true },
};

export function normalizeTossError(error: any): {
  code: string;
  message: string;
  category: ErrorCategory;
  retryable: boolean;
} {
  const code = error?.code || error?.errorCode || "UNKNOWN_ERROR";
  const message = error?.message || error?.errorMessage || "알 수 없는 오류";

  const mapped = TOSS_ERROR_MAP[code];
  if (mapped) {
    return { code, message, ...mapped };
  }

  // 매핑되지 않은 에러는 재시도 가능으로 처리 (보수적)
  return {
    code,
    message,
    category: "unknown",
    retryable: true,
  };
}

/* =========================================================
   재시도 스케줄 계산
   ========================================================= */

/**
 * 재시도 스케줄:
 * - 1차 실패 → +1일 후 재시도
 * - 2차 실패 → +3일 후 재시도
 * - 3차 실패 → null (자동 해지)
 */
export function calculateNextRetryAt(attemptNumber: number): Date | null {
  const now = new Date();

  if (attemptNumber === 1) {
    // 1차 실패 후 → 다음 날
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    return next;
  }

  if (attemptNumber === 2) {
    // 2차 실패 후 → 3일 뒤
    const next = new Date(now);
    next.setDate(next.getDate() + 3);
    return next;
  }

  // 3차 이상 실패 → 자동 해지
  return null;
}

/* =========================================================
   토스 빌링 API 호출 (핵심)
   ========================================================= */

export async function chargeWithBillingKey(
  params: ChargeParams
): Promise<ChargeResult> {
  const baseUrl = getTossBaseUrl();
  const url = `${baseUrl}/v1/billing/${encodeURIComponent(params.billingKey)}`;

  const body = {
    customerKey: params.customerKey,
    amount: params.amount,
    orderId: params.orderId,
    orderName: params.orderName,
    customerEmail: params.customerEmail,
    customerName: params.customerName,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      // 토스 에러 응답
      const normalized = normalizeTossError(data);
      return {
        success: false,
        errorCode: normalized.code,
        errorMessage: normalized.message,
        errorCategory: normalized.category,
        retryable: normalized.retryable,
        rawResponse: data,
      };
    }

    // 성공 응답
    return {
      success: true,
      paymentKey: data.paymentKey,
      orderId: data.orderId,
      approvedAt: data.approvedAt,
      receiptUrl: data.receipt?.url,
      rawResponse: data,
    };
  } catch (networkError: any) {
    // fetch 자체 실패 (네트워크 에러 등)
    return {
      success: false,
      errorCode: "NETWORK_ERROR",
      errorMessage: networkError?.message || "네트워크 오류",
      errorCategory: "network",
      retryable: true,
      rawResponse: { networkError: String(networkError) },
    };
  }
}

/* =========================================================
   BillingLog 통합 기록
   ========================================================= */

/**
 * 빌링 시도 기록 시작 — status='pending'으로 INSERT
 * @returns billing_logs.id
 */
export async function logBillingAttempt(params: LogParams): Promise<number> {
  const result: any = await db.insert(billingLogs).values({
    memberId: params.memberId,
    billingKey: params.billingKey,
    attemptType: params.attemptType,
    attemptNumber: params.attemptNumber,
    amount: params.amount,
    status: "pending",
    tossOrderId: params.tossOrderId,
  } as any).returning({ id: billingLogs.id });
  const rows = Array.isArray(result) ? result : (result as any).rows || [];
  const logId = rows[0]?.id;
  if (!logId) {
    throw new Error("[toss-billing] billing_logs INSERT 실패 — id 없음");
  }
  return logId;
}

/**
 * 빌링 결과 기록 — 시도 결과로 UPDATE
 */
export async function logBillingResult(
  logId: number,
  result: ChargeResult,
  donationId?: number
): Promise<void> {
  const now = new Date();
  const nextRetryAt = result.success
    ? null
    : result.retryable
      ? calculateNextRetryAt(1) // 다음 시도 차수는 호출자가 별도 계산
      : null;

  await db.update(billingLogs)
    .set({
      status: result.success ? "success" : "failed",
      tossPaymentKey: result.paymentKey,
      tossResponseCode: result.errorCode,
      tossResponseMessage: result.errorMessage,
      errorDetail: result.rawResponse,
      donationId: donationId,
      completedAt: now,
      nextRetryAt: nextRetryAt,
    } as any)
    .where(eq(billingLogs.id, logId));
}

/**
 * 빌링 결과 + 다음 재시도 시점 명시적 지정 (고급)
 */
export async function logBillingResultWithRetry(
  logId: number,
  result: ChargeResult,
  nextAttemptNumber: number,
  donationId?: number
): Promise<void> {
  const now = new Date();
  const nextRetryAt = result.success
    ? null
    : result.retryable
      ? calculateNextRetryAt(nextAttemptNumber - 1)
      : null;

  await db.update(billingLogs)
    .set({
      status: result.success ? "success" : "failed",
      tossPaymentKey: result.paymentKey,
      tossResponseCode: result.errorCode,
      tossResponseMessage: result.errorMessage,
      errorDetail: result.rawResponse,
      donationId: donationId,
      completedAt: now,
      nextRetryAt: nextRetryAt,
    } as any)
    .where(eq(billingLogs.id, logId));
}

/* =========================================================
   헬퍼: YYYYMM 생성
   ========================================================= */

export function getCurrentYearMonth(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
}

/* =========================================================
   헬퍼: 다음 약정일 계산
   ========================================================= */

/**
 * billingDay를 기준으로 다음 청구일 계산
 * 31일 약정인데 2월 등 짧은 달이면 월말로 보정
 */
export function calculateNextBillingDate(billingDay: number, from: Date = new Date()): Date {
  const fromYear = from.getFullYear();
  const fromMonth = from.getMonth(); // 0-indexed
  const fromDay = from.getDate();

  let nextYear: number;
  let nextMonth: number;

  if (fromDay < billingDay) {
    // 이번 달 아직 약정일 안 지남
    nextYear = fromYear;
    nextMonth = fromMonth;
  } else {
    // 이번 달 약정일 지났거나 당일 → 다음 달
    nextYear = fromMonth === 11 ? fromYear + 1 : fromYear;
    nextMonth = fromMonth === 11 ? 0 : fromMonth + 1;
  }

  const lastDayOfMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
  const safeDay = Math.min(billingDay, lastDayOfMonth);

  return new Date(nextYear, nextMonth, safeDay);
}

/* =========================================================
   토스 환불(취소) API — 일시 결제·정기 결제 환불 공용
   POST /v1/payments/{paymentKey}/cancel
   - 전액 환불: cancelAmount 생략
   - 부분 환불: cancelAmount 지정 (현재는 전액만 지원)
   ========================================================= */

export interface CancelResult {
  success: boolean;
  status?: string;           // 'CANCELED' | 'PARTIAL_CANCELED' 등
  canceledAt?: string;
  cancelAmount?: number;
  transactionKey?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: any;
}

export async function cancelTossPayment(
  paymentKey: string,
  cancelReason: string,
  cancelAmount?: number,
): Promise<CancelResult> {
  if (!paymentKey || typeof paymentKey !== "string") {
    return { success: false, errorCode: "MISSING_PAYMENT_KEY", errorMessage: "토스 paymentKey가 없습니다" };
  }
  /* 사유 비었거나 너무 짧으면 안전한 기본값으로 (토스 필수 필드) */
  const safeReason = (cancelReason || "관리자 환불").trim().slice(0, 200) || "관리자 환불";

  const body: any = { cancelReason: safeReason };
  if (typeof cancelAmount === "number" && cancelAmount > 0) {
    body.cancelAmount = Math.floor(cancelAmount);
  }

  const url = `${getTossBaseUrl()}/v1/payments/${encodeURIComponent(paymentKey)}/cancel`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": getAuthHeader(),
        "Content-Type": "application/json",
        "Idempotency-Key": `cancel-${paymentKey}-${Date.now()}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    return {
      success: false,
      errorCode: "NETWORK_ERROR",
      errorMessage: String(e?.message || e).slice(0, 300),
    };
  }

  let json: any = null;
  try { json = await resp.json(); } catch { json = null; }

  if (!resp.ok) {
    const normalized = normalizeTossError(json);
    return {
      success: false,
      errorCode: normalized.code,
      errorMessage: normalized.message,
      rawResponse: json,
    };
  }

  /* 성공 — 마지막 cancels 행에서 환불 정보 추출 */
  const cancels = Array.isArray(json?.cancels) ? json.cancels : [];
  const lastCancel = cancels[cancels.length - 1] || {};

  return {
    success: true,
    status: json?.status,
    canceledAt: lastCancel.canceledAt || json?.lastTransactionKey,
    cancelAmount: Number(lastCancel.cancelAmount) || cancelAmount,
    transactionKey: lastCancel.transactionKey,
    rawResponse: json,
  };
}
