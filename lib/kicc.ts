// lib/kicc.ts
// R40: KICC(이지페이) 결제 API 라이브러리 — 토스 lib/toss-billing.ts 전면 대체.
// ★ fix/r40-kicc-spec: docs/kicc.md(EP9 실측 명세)와 정합화.
// - 일시: 거래등록(webpay)→authPageUrl→승인(approval)
// - 정기: 빌키 등록창(webpay payMethodTypeCode=81·amount 0)→빌키발급(approval·cardNo=빌키)→자동결제(approval/batch)
// - 취소·환불(revise) / 빌키삭제(removeBatchKey) / 거래조회(retrieveTransaction)
// - PG 비종속 키명(pg_*) — billingLogs 로깅 통합
// - 효성 CMS+(계좌이체)는 별도 경로(불변)
//
// ※ msgAuthValue 규칙(kicc.md):
//   - 요청 body에 넣는 곳은 revise(취소/환불)뿐 → HmacSHA256(secret, `pgCno|shopTransactionId`) (kicc.md:1841-1844)
//   - webpay/approval/approval/batch/removeBatchKey/retrieveTransaction 요청엔 msgAuthValue 없음
//   - 승인/빌키발급/자동결제 "응답" 무결성 검증 → HmacSHA256(secret, `pgCno|amount|transactionDate`) (kicc.md:746-749)
//   응답 검증은 비차단(경고 로그) — 1차 보안 게이트는 호출부의 서버 금액 대조.
//
// 본 모듈의 "반환 shape"는 A mock·C 검증의 고정 계약이므로 변경 금지.

import { db } from "../db";
import { billingLogs } from "../db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

/* =========================================================
   타입 (반환 shape 고정)
   ========================================================= */

export type ErrorCategory =
  | "card_invalid"
  | "insufficient_funds"
  | "declined"
  | "network"
  | "rate_limit"
  | "unknown";

/** 자동결제(빌키 청구) 결과 — cron-kicc-billing·billing-approve 1회차 공용 */
export interface ChargeResult {
  success: boolean;
  pgTid?: string; // KICC pgCno
  shopOrderNo?: string;
  amount?: number;
  statusCode?: string;
  approvedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  errorCategory?: ErrorCategory;
  retryable?: boolean;
  raw?: any;
}

export interface RegisterResult {
  success: boolean;
  authPageUrl?: string;
  shopOrderNo?: string;
  errorCode?: string;
  errorMessage?: string;
  raw?: any;
}

export interface ApproveResult {
  success: boolean;
  pgTid?: string; // pgCno
  amount?: number;
  statusCode?: string;
  cardCompany?: string; // cardInfo.issuerName
  cardNumberMasked?: string; // cardInfo.cardMaskNo(빌키발급) | cardInfo.cardNo(일시)
  cardType?: string; // 신용 | 체크 | 기프트
  billKey?: string; // 빌키발급 시 cardInfo.cardNo
  approvedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  errorCategory?: ErrorCategory;
  retryable?: boolean;
  raw?: any;
}

export interface CancelResult {
  success: boolean;
  status?: string;
  canceledAt?: string;
  cancelAmount?: number;
  pgTid?: string;
  errorCode?: string;
  errorMessage?: string;
  raw?: any;
}

export interface LogParams {
  memberId: number;
  billingKey: string;
  attemptType: "scheduled" | "retry" | "manual";
  attemptNumber: number;
  amount: number;
  pgOrderNo: string;
}

/* =========================================================
   환경 설정
   ========================================================= */

export function getKiccConfig(): {
  mode: "test" | "live";
  apiDomain: string;
  mallId: string;
  secretKey: string;
} {
  const mode = ((process.env.KICC_MODE || "test").toLowerCase() === "live" ? "live" : "test") as
    | "test"
    | "live";
  let apiDomain =
    process.env.KICC_API_DOMAIN ||
    (mode === "live" ? "https://pgapi.easypay.co.kr" : "https://testpgapi.easypay.co.kr");
  // env에 스킴 없이(testpgapi.easypay.co.kr) 넣어도 동작하도록 정규화
  apiDomain = apiDomain.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(apiDomain)) apiDomain = "https://" + apiDomain;
  const mallId = process.env.KICC_MALL_ID || "";
  const secretKey = process.env.KICC_SECRET_KEY || "";
  return { mode, apiDomain, mallId, secretKey };
}

/** HmacSHA256(secretKey, plain) → hex (소문자) */
export function signMsgAuth(plain: string): string {
  const { secretKey } = getKiccConfig();
  return crypto.createHmac("sha256", secretKey).update(plain, "utf8").digest("hex");
}

/** 응답 무결성 검증 — HmacSHA256(secret, `pgCno|amount|transactionDate`) === resp.msgAuthValue (비차단) */
export function verifyMsgAuth(j: any): boolean {
  const { secretKey } = getKiccConfig();
  if (!secretKey || !j?.msgAuthValue || j?.pgCno == null) return false;
  const plain = `${j.pgCno}|${j.amount}|${j.transactionDate}`;
  return signMsgAuth(plain) === String(j.msgAuthValue);
}

/* =========================================================
   요청 식별자·날짜 헬퍼
   ========================================================= */

/** 승인/취소 요청일자 yyyyMMdd (KST 기준) */
function reqDateYmd(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}${String(kst.getUTCDate()).padStart(2, "0")}`;
}

/** 멱등 거래키 shopTransactionId(≤60Byte) — 같은 논리 거래는 같은 키(네트워크 재시도 시 중복방지),
 *  서로 다른 시도는 다른 키. base(shopOrderNo)에 접미사. */
function makeTxId(base: string, suffix: string): string {
  const s = `${base}-${suffix}`;
  return s.length > 60 ? s.slice(s.length - 60) : s;
}

/* =========================================================
   공용 HTTP — TLS1.2 기본(undici) + 30초 타임아웃
   ========================================================= */

async function kiccPost(
  path: string,
  body: any,
): Promise<{ ok: boolean; status: number; json: any; networkError?: string }> {
  const { apiDomain } = getKiccConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch(`${apiDomain}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let json: any = null;
    try {
      json = await resp.json();
    } catch {
      json = null;
    }
    return { ok: resp.ok, status: resp.status, json };
  } catch (e: any) {
    return { ok: false, status: 0, json: null, networkError: String(e?.message || e).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

function isOk(j: any): boolean {
  return String(j?.resCd) === "0000";
}

/* =========================================================
   에러 정규화 — resCd(code) + resMsg 키워드 분류
   ========================================================= */

export function normalizeKiccError(input: any): {
  code: string;
  message: string;
  category: ErrorCategory;
  retryable: boolean;
} {
  const code = String(input?.resCd || input?.code || input?.errorCode || "UNKNOWN");
  const message = String(input?.resMsg || input?.message || input?.errorMessage || "알 수 없는 오류");
  if (/한도|초과|잔액|부족/.test(message))
    return { code, message, category: "insufficient_funds", retryable: true };
  if (/만료|유효기간|분실|도난|정지|해지|등록되지|유효하지|비밀번호|타입오류|불일치/.test(message))
    return { code, message, category: "card_invalid", retryable: false };
  if (/거절|불가|실패|취소/.test(message)) return { code, message, category: "declined", retryable: true };
  if (/타임아웃|timeout|네트워크|통신|지연/i.test(message))
    return { code, message, category: "network", retryable: true };
  return { code, message, category: "unknown", retryable: true };
}

/** cardGubun(N/Y/G) → 한글 카드종류 */
function cardTypeKo(cardGubun: any): string {
  if (cardGubun === "Y") return "체크";
  if (cardGubun === "G") return "기프트";
  return "신용";
}

/* =========================================================
   1. 거래등록 (POST /api/ep9/trades/webpay) — 일시·정기 공용
   ========================================================= */

export interface RegisterTradeParams {
  shopOrderNo: string;
  amount: number;
  goodsName: string;
  returnUrl: string;
  isBillingKey?: boolean; // true면 정기 빌키 등록창(payMethodTypeCode 81·amount 0·certType 0)
  customerName?: string;
  customerEmail?: string;
}

export async function registerTrade(p: RegisterTradeParams): Promise<RegisterResult> {
  const { mallId } = getKiccConfig();
  const body: any = {
    mallId,
    shopOrderNo: p.shopOrderNo,
    amount: p.isBillingKey ? 0 : p.amount,
    payMethodTypeCode: p.isBillingKey ? "81" : "11",
    currency: "00",
    clientTypeCode: "00", // 통합형 고정
    returnUrl: p.returnUrl,
    deviceTypeCode: "pc",
    orderInfo: {
      goodsName: p.goodsName,
      customerInfo: {
        customerName: p.customerName || "",
        customerMail: p.customerEmail || "",
      },
    },
  };
  if (p.isBillingKey) {
    body.payMethodInfo = { billKeyMethodInfo: { certType: "0" } };
  }
  const r = await kiccPost("/api/ep9/trades/webpay", body);
  if (r.networkError)
    return { success: false, errorCode: "NETWORK_ERROR", errorMessage: r.networkError, raw: { networkError: r.networkError } };
  const j = r.json || {};
  if (!isOk(j)) {
    const e = normalizeKiccError(j);
    return { success: false, errorCode: e.code, errorMessage: e.message, raw: j };
  }
  return {
    success: true,
    authPageUrl: j.authPageUrl || j.authPageURL || j.pageUrl || "",
    shopOrderNo: j.shopOrderNo || p.shopOrderNo,
    raw: j,
  };
}

/* =========================================================
   2. 승인 (POST /api/ep9/trades/approval) — 일시 결제 / 빌키 발급 공용
   요청: mallId·shopTransactionId(멱등키)·authorizationId·shopOrderNo·approvalReqDate (amount·msgAuthValue 없음)
   ========================================================= */

export interface ApproveTradeParams {
  authorizationId: string;
  shopOrderNo: string;
}

export async function approveTrade(p: ApproveTradeParams): Promise<ApproveResult> {
  const { mallId } = getKiccConfig();
  const body: any = {
    mallId,
    shopTransactionId: makeTxId(p.shopOrderNo, "AP"),
    authorizationId: p.authorizationId,
    shopOrderNo: p.shopOrderNo,
    approvalReqDate: reqDateYmd(),
  };
  const r = await kiccPost("/api/ep9/trades/approval", body);
  if (r.networkError)
    return {
      success: false,
      errorCode: "NETWORK_ERROR",
      errorMessage: r.networkError,
      errorCategory: "network",
      retryable: true,
      raw: { networkError: r.networkError },
    };
  const j = r.json || {};
  if (!isOk(j)) {
    const e = normalizeKiccError(j);
    return {
      success: false,
      errorCode: e.code,
      errorMessage: e.message,
      errorCategory: e.category,
      retryable: e.retryable,
      raw: j,
    };
  }
  if (j.msgAuthValue && !verifyMsgAuth(j)) {
    console.warn(`[kicc] approval 응답 msgAuthValue 불일치(비차단) shopOrderNo=${p.shopOrderNo}`);
  }
  const cardInfo = (j.paymentInfo && j.paymentInfo.cardInfo) || {};
  // 빌키발급 응답: cardInfo.cardNo = 빌키, cardInfo.cardMaskNo = 마스킹번호.
  // 일시 승인 응답: cardInfo.cardNo = 마스킹번호(빌키 없음).
  const hasBillKey = typeof cardInfo.cardMaskNo === "string" && cardInfo.cardMaskNo.length > 0;
  return {
    success: true,
    pgTid: j.pgCno,
    amount: Number(j.amount),
    statusCode: j.statusCode,
    cardCompany: cardInfo.issuerName || cardInfo.acquirerName,
    cardNumberMasked: hasBillKey ? cardInfo.cardMaskNo : cardInfo.cardNo,
    cardType: cardTypeKo(cardInfo.cardGubun),
    billKey: hasBillKey ? cardInfo.cardNo : undefined,
    approvedAt: j.transactionDate,
    raw: j,
  };
}

/* =========================================================
   3. 자동결제 (POST /api/trades/approval/batch) — 빌키 청구
   요청: mallId·shopTransactionId·shopOrderNo·approvalReqDate·amount·currency·orderInfo·payMethodInfo (msgAuthValue 없음)
   ========================================================= */

export interface ChargeParams {
  billingKey: string; // batchKey
  shopOrderNo: string;
  amount: number;
  goodsName: string;
  customerName?: string;
  customerEmail?: string;
}

export async function chargeWithBillingKey(p: ChargeParams): Promise<ChargeResult> {
  const { mallId } = getKiccConfig();
  const body: any = {
    mallId,
    shopTransactionId: makeTxId(p.shopOrderNo, "BT"),
    shopOrderNo: p.shopOrderNo,
    approvalReqDate: reqDateYmd(),
    amount: p.amount,
    currency: "00",
    orderInfo: { goodsName: p.goodsName },
    payMethodInfo: {
      billKeyMethodInfo: { batchKey: p.billingKey },
      cardMethodInfo: { installmentMonth: 0 },
    },
  };
  const r = await kiccPost("/api/trades/approval/batch", body);
  if (r.networkError)
    return {
      success: false,
      shopOrderNo: p.shopOrderNo,
      errorCode: "NETWORK_ERROR",
      errorMessage: r.networkError,
      errorCategory: "network",
      retryable: true,
      raw: { networkError: r.networkError },
    };
  const j = r.json || {};
  if (!isOk(j)) {
    const e = normalizeKiccError(j);
    return {
      success: false,
      shopOrderNo: p.shopOrderNo,
      errorCode: e.code,
      errorMessage: e.message,
      errorCategory: e.category,
      retryable: e.retryable,
      raw: j,
    };
  }
  if (j.msgAuthValue && !verifyMsgAuth(j)) {
    console.warn(`[kicc] batch 응답 msgAuthValue 불일치(비차단) shopOrderNo=${p.shopOrderNo}`);
  }
  return {
    success: true,
    pgTid: j.pgCno,
    shopOrderNo: j.shopOrderNo || p.shopOrderNo,
    amount: Number(j.amount) || p.amount,
    statusCode: j.statusCode,
    approvedAt: j.transactionDate,
    raw: j,
  };
}

/* =========================================================
   4. 취소·환불 (POST /api/trades/revise) — ★ 요청 msgAuthValue 필수
   msgAuthValue = HmacSHA256(secret, `pgCno|shopTransactionId`)
   ========================================================= */

export async function cancelPayment(p: {
  pgTid: string;
  amount?: number;
  reviseTypeCode?: string; // 기본 "40" 전체취소 (32=신용카드 부분취소)
  reason?: string;
}): Promise<CancelResult> {
  if (!p.pgTid) return { success: false, errorCode: "MISSING_PG_TID", errorMessage: "pgTid(pgCno)가 없습니다" };
  const { mallId } = getKiccConfig();
  const reviseTypeCode = p.reviseTypeCode || "40"; // 40=전체취소
  const shopTransactionId = makeTxId(p.pgTid, `CX${Date.now().toString(36)}`);
  const body: any = {
    mallId,
    shopTransactionId,
    pgCno: p.pgTid,
    reviseTypeCode,
    cancelReqDate: reqDateYmd(),
    msgAuthValue: signMsgAuth(`${p.pgTid}|${shopTransactionId}`),
    reviseMessage: (p.reason || "관리자 취소").slice(0, 100),
  };
  if (typeof p.amount === "number" && p.amount > 0) body.amount = Math.floor(p.amount);
  const r = await kiccPost("/api/trades/revise", body);
  if (r.networkError)
    return { success: false, errorCode: "NETWORK_ERROR", errorMessage: r.networkError, raw: { networkError: r.networkError } };
  const j = r.json || {};
  if (!isOk(j)) {
    const e = normalizeKiccError(j);
    return { success: false, errorCode: e.code, errorMessage: e.message, raw: j };
  }
  return {
    success: true,
    status: j.statusCode || "TS02",
    canceledAt: j.transactionDate,
    cancelAmount: Number(j.cancelAmount) || p.amount,
    pgTid: j.cancelPgCno || j.oriPgCno || p.pgTid,
    raw: j,
  };
}

/* =========================================================
   5. 빌키 삭제 (POST /api/trades/removeBatchKey)
   요청: mallId·shopTransactionId·batchKey·removeReqDate (msgAuthValue 없음)
   ========================================================= */

export async function removeBillingKey(p: {
  billingKey: string;
}): Promise<{ success: boolean; raw?: any; errorCode?: string; errorMessage?: string }> {
  if (!p.billingKey) return { success: false, errorCode: "MISSING_BILLKEY", errorMessage: "빌키가 없습니다" };
  const { mallId } = getKiccConfig();
  const body: any = {
    mallId,
    shopTransactionId: makeTxId(p.billingKey.slice(0, 30), `RM${Date.now().toString(36)}`),
    batchKey: p.billingKey,
    removeReqDate: reqDateYmd(),
  };
  const r = await kiccPost("/api/trades/removeBatchKey", body);
  if (r.networkError)
    return { success: false, errorCode: "NETWORK_ERROR", errorMessage: r.networkError, raw: { networkError: r.networkError } };
  const j = r.json || {};
  if (!isOk(j)) {
    const e = normalizeKiccError(j);
    return { success: false, errorCode: e.code, errorMessage: e.message, raw: j };
  }
  return { success: true, raw: j };
}

/* =========================================================
   6. 거래조회 (POST /api/trades/retrieveTransaction)
   요청: mallId·shopTransactionId·transactionDate(yyyyMMdd) — 승인/취소 미수신 복구용
   ========================================================= */

export async function retrieveTransaction(p: {
  shopTransactionId: string;
  transactionDate?: string; // yyyyMMdd (기본 오늘 KST)
}): Promise<{
  success: boolean;
  statusCode?: string;
  amount?: number;
  pgTid?: string;
  raw?: any;
  errorCode?: string;
  errorMessage?: string;
}> {
  const { mallId } = getKiccConfig();
  const body: any = {
    mallId,
    shopTransactionId: p.shopTransactionId,
    transactionDate: p.transactionDate || reqDateYmd(),
  };
  const r = await kiccPost("/api/trades/retrieveTransaction", body);
  if (r.networkError)
    return { success: false, errorCode: "NETWORK_ERROR", errorMessage: r.networkError, raw: { networkError: r.networkError } };
  const j = r.json || {};
  if (!isOk(j)) {
    const e = normalizeKiccError(j);
    return { success: false, errorCode: e.code, errorMessage: e.message, raw: j };
  }
  return { success: true, statusCode: j.statusCode, amount: Number(j.amount), pgTid: j.pgCno, raw: j };
}

/* =========================================================
   shopOrderNo 생성 (멱등) — pg 비종속
   ========================================================= */

/** 일시 결제용 주문번호 — SIREN-{YYYYMM}-{rand} (≤40자) */
export function generateShopOrderNo(prefix = "SIREN"): string {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let rand = "";
  for (let i = 0; i < 10; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${ym}-${rand}`;
}

/**
 * 정기 청구용 주문번호 — 동일 회원·동일 월·동일 차수는 동일 → 이중청구 방지.
 * 형식: SIREN-BILL-{yearMonth}-{memberId}{-rN}  (≤40자)
 */
export function generateBillingOrderId(
  memberId: number,
  yearMonth: string,
  retryNumber: number = 1,
): string {
  const suffix = retryNumber > 1 ? `-r${retryNumber}` : "";
  return `SIREN-BILL-${yearMonth}-${memberId}${suffix}`;
}

/* =========================================================
   재시도 스케줄 / 청구일 / 연월 — pg 비종속(불변)
   ========================================================= */

/** 1차 실패→+1일 / 2차 실패→+3일 / 3차 이상→null(자동해지) */
export function calculateNextRetryAt(attemptNumber: number): Date | null {
  const now = new Date();
  if (attemptNumber === 1) {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    return next;
  }
  if (attemptNumber === 2) {
    const next = new Date(now);
    next.setDate(next.getDate() + 3);
    return next;
  }
  return null;
}

/** billingDay 기준 다음 청구일 (월말 보정) */
export function calculateNextBillingDate(billingDay: number, from: Date = new Date()): Date {
  const fromYear = from.getFullYear();
  const fromMonth = from.getMonth();
  const fromDay = from.getDate();
  let nextYear: number;
  let nextMonth: number;
  if (fromDay < billingDay) {
    nextYear = fromYear;
    nextMonth = fromMonth;
  } else {
    nextYear = fromMonth === 11 ? fromYear + 1 : fromYear;
    nextMonth = fromMonth === 11 ? 0 : fromMonth + 1;
  }
  const lastDayOfMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
  const safeDay = Math.min(billingDay, lastDayOfMonth);
  return new Date(nextYear, nextMonth, safeDay);
}

export function getCurrentYearMonth(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
}

/* =========================================================
   BillingLog 통합 기록 — pg_* 키명
   ========================================================= */

/** 빌링 시도 시작 — status='pending' INSERT → billing_logs.id 반환 */
export async function logBillingAttempt(params: LogParams): Promise<number> {
  const result: any = await db
    .insert(billingLogs)
    .values({
      memberId: params.memberId,
      billingKey: params.billingKey,
      attemptType: params.attemptType,
      attemptNumber: params.attemptNumber,
      amount: params.amount,
      status: "pending",
      pgOrderNo: params.pgOrderNo,
      pgProvider: "kicc",
    } as any)
    .returning({ id: billingLogs.id });
  const rows = Array.isArray(result) ? result : (result as any).rows || [];
  const logId = rows[0]?.id;
  if (!logId) throw new Error("[kicc] billing_logs INSERT 실패 — id 없음");
  return logId;
}

/** 빌링 결과 UPDATE — 다음 재시도 차수 명시 */
export async function logBillingResultWithRetry(
  logId: number,
  result: ChargeResult,
  nextAttemptNumber: number,
  donationId?: number,
): Promise<void> {
  const now = new Date();
  const nextRetryAt = result.success
    ? null
    : result.retryable
      ? calculateNextRetryAt(nextAttemptNumber - 1)
      : null;
  await db
    .update(billingLogs)
    .set({
      status: result.success ? "success" : "failed",
      pgTid: result.pgTid,
      pgResponseCode: result.errorCode,
      pgResponseMessage: result.errorMessage,
      errorDetail: result.raw,
      donationId: donationId,
      completedAt: now,
      nextRetryAt: nextRetryAt,
    } as any)
    .where(eq(billingLogs.id, logId));
}

/** 빌링 결과 UPDATE (단순) */
export async function logBillingResult(
  logId: number,
  result: ChargeResult,
  donationId?: number,
): Promise<void> {
  return logBillingResultWithRetry(logId, result, 2, donationId);
}
