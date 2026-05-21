// lib/kicc.ts
// R40: KICC(이지페이) 결제 API 라이브러리 — 토스 lib/toss-billing.ts 전면 대체.
// - 일시: 거래등록(webpay)→authPageUrl→승인(approval)
// - 정기: 빌키 발급창(webpay clientTypeCode=81)→승인(빌키 회신)→자동결제(approval/batch)
// - 취소·환불(revise) / 빌키삭제(removeBatchKey) / 거래조회(retrieveTransaction)
// - PG 비종속 키명(pg_*) — billingLogs 로깅 통합 (logBillingAttempt/logBillingResult)
// - 효성 CMS+(계좌이체)는 별도 경로(불변)
//
// ※ KICC 요청 필드 구성·msgAuthValue 평문 순서·resCd 코드표는 실거래 테스트 시
//   KICC EP9 매뉴얼로 최종 검증 필요(아래 each 함수 주석 참고). 본 모듈의 "반환 shape"는
//   A mock·C 검증의 고정 계약이므로 변경 금지.

import { db } from "../db";
import { billingLogs } from "../db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

/* =========================================================
   타입
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
  pgTid?: string;        // KICC pgCno
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
  authPageUrl?: string;  // 결제창/빌키등록창 URL
  shopOrderNo?: string;
  errorCode?: string;
  errorMessage?: string;
  raw?: any;
}

export interface ApproveResult {
  success: boolean;
  pgTid?: string;            // pgCno
  amount?: number;
  statusCode?: string;
  cardCompany?: string;      // paymentInfo.cardInfo.cardName/issuerName
  cardNumberMasked?: string; // 마스킹 표시용
  cardType?: string;
  billKey?: string;          // 정기 발급 시 빌키(batchKey, 최대 60자)
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
  // env에 스킴 없이(testpgapi.easypay.co.kr) 넣어도 동작하도록 정규화 — 없으면 https:// 보정, 끝 슬래시 제거
  apiDomain = apiDomain.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(apiDomain)) apiDomain = "https://" + apiDomain;
  const mallId = process.env.KICC_MALL_ID || "";
  const secretKey = process.env.KICC_SECRET_KEY || "";
  return { mode, apiDomain, mallId, secretKey };
}

/**
 * msgAuthValue — HMAC-SHA256(secretKey, plain) → hex.
 * 평문(plain) 필드 순서는 KICC EP9 매뉴얼 기준이며 엔드포인트별로 다름(실거래 검증 필요).
 */
export function signMsgAuth(plain: string): string {
  const { secretKey } = getKiccConfig();
  return crypto.createHmac("sha256", secretKey).update(plain, "utf8").digest("hex");
}

/** 응답 무결성 검증 — 평문 pgCno|amount|transactionDate (kicc.md §msgAuth). 불일치 시 false */
export function verifyResponseMsgAuth(j: any): boolean {
  if (!j || !j.msgAuthValue) return true; // 인증값 미제공 응답(조회 등)은 통과
  const plain = `${j.pgCno ?? ""}|${j.amount ?? ""}|${j.transactionDate ?? ""}`;
  try {
    return signMsgAuth(plain) === String(j.msgAuthValue);
  } catch {
    return true; // 검증 실패해도 결제 자체는 막지 않음(로깅용)
  }
}

/** KST 기준 요청일자 yyyyMMdd (approvalReqDate·cancelReqDate·removeReqDate 공통) */
function reqDateYmd(d: Date = new Date()): string {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}${String(kst.getUTCDate()).padStart(2, "0")}`;
}

/** 상점 거래고유번호(API 멱등성 키, ≤60). 인자 있으면 그대로(멱등·복구 가능), 없으면 랜덤 */
function txnId(seed?: string): string {
  if (seed && seed.length <= 60) return seed;
  return crypto.randomUUID().replace(/-/g, "");
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
   에러 정규화 — resCd/resMsg 키워드 기반 (KICC 코드표 실거래 검증)
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
  if (/만료|유효기간|분실|도난|정지|해지|등록되지|유효하지|비밀번호/.test(message))
    return { code, message, category: "card_invalid", retryable: false };
  if (/거절|불가|실패/.test(message)) return { code, message, category: "declined", retryable: true };
  if (/타임아웃|timeout|네트워크|통신/i.test(message))
    return { code, message, category: "network", retryable: true };
  return { code, message, category: "unknown", retryable: true };
}

/* =========================================================
   빌키 추출 헬퍼 (발급 approval 응답)
   ========================================================= */

function pickBillKey(j: any): string | undefined {
  const cardInfo = (j?.paymentInfo && j.paymentInfo.cardInfo) || j?.cardInfo || {};
  const candidates = [
    j?.batchKey,
    j?.billKey,
    j?.billKeyMethodInfo?.batchKey,
    j?.paymentInfo?.batchKeyInfo?.batchKey,
    j?.paymentInfo?.cardInfo?.batchKey,
    cardInfo?.batchKey,
    cardInfo?.cardNo, // KICC: 빌키(60자)를 cardNo로 회신하는 케이스
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length >= 20) return c;
  }
  return undefined;
}

function pickMaskedCardNo(cardInfo: any): string | undefined {
  const m = cardInfo?.cardNoMasked || cardInfo?.maskCardNo || cardInfo?.cardNum;
  if (typeof m === "string" && m.length > 0) return m;
  // cardNo가 짧으면(마스킹 표시번호) 사용, 길면(빌키) 제외
  if (typeof cardInfo?.cardNo === "string" && cardInfo.cardNo.length <= 20) return cardInfo.cardNo;
  return undefined;
}

/* =========================================================
   1. 거래등록 (POST /api/ep9/trades/webpay) — 일시·정기 공용
   ========================================================= */

export interface RegisterTradeParams {
  shopOrderNo: string;
  amount: number;
  goodsName: string;
  returnUrl: string;
  // 일시 신용카드 "11"(기본) / 정기 빌키등록 "81". clientTypeCode는 통합형 "00" 고정(kicc.md).
  payMethodTypeCode?: string;
  certType?: string;   // 빌키등록(정기) 시 카드 인증타입 "0"(기본)
  deviceTypeCode?: string; // "pc"(기본)/"mobile"
  customerName?: string;   // (현재 KICC webpay 요청 미포함·호출부 호환용)
  customerEmail?: string;
}

export async function registerTrade(p: RegisterTradeParams): Promise<RegisterResult> {
  const { mallId } = getKiccConfig();
  const payMethodTypeCode = p.payMethodTypeCode || "11";
  const isBillKey = payMethodTypeCode === "81";
  // kicc.md: 거래등록(webpay) 요청에 msgAuthValue 없음 / clientTypeCode 통합형 "00" 고정 /
  //          빌키등록은 amount:0 + payMethodInfo.billKeyMethodInfo.certType
  const body: any = {
    mallId,
    shopOrderNo: p.shopOrderNo,
    amount: isBillKey ? 0 : p.amount,
    payMethodTypeCode,
    currency: "00",
    clientTypeCode: "00",
    returnUrl: p.returnUrl,
    deviceTypeCode: p.deviceTypeCode || "pc",
    orderInfo: { goodsName: p.goodsName },
  };
  if (isBillKey) {
    body.payMethodInfo = { billKeyMethodInfo: { certType: p.certType || "0" } };
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
   ========================================================= */

export interface ApproveTradeParams {
  authorizationId: string;
  shopOrderNo: string;
  amount: number;
}

export async function approveTrade(p: ApproveTradeParams): Promise<ApproveResult> {
  const { mallId } = getKiccConfig();
  // kicc.md 승인 요청 필수: mallId·shopTransactionId(멱등키)·authorizationId·shopOrderNo·approvalReqDate(yyyyMMdd)
  //   amount·msgAuthValue는 요청에 없음(amount는 응답으로 받아 서버 금액과 대조).
  const body: any = {
    mallId,
    shopTransactionId: txnId(p.shopOrderNo),
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
  const cardInfo = (j.paymentInfo && j.paymentInfo.cardInfo) || j.cardInfo || {};
  return {
    success: true,
    pgTid: j.pgCno || j.pgTid,
    amount: Number(j.amount) || p.amount,
    statusCode: j.statusCode || j.transStatus,
    cardCompany: cardInfo.cardName || cardInfo.issuerName || cardInfo.acquirerName,
    cardNumberMasked: pickMaskedCardNo(cardInfo),
    cardType: cardInfo.cardType,
    billKey: pickBillKey(j),
    approvedAt: j.transDt || j.approvalDate || j.transDate,
    raw: j,
  };
}

/* =========================================================
   3. 자동결제 (POST /api/trades/approval/batch) — 빌키 청구
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
  // kicc.md 자동결제(approval/batch) 필수: mallId·shopTransactionId·shopOrderNo·approvalReqDate·amount·currency·orderInfo
  //   + payMethodInfo.billKeyMethodInfo.batchKey + payMethodInfo.cardMethodInfo.installmentMonth. msgAuthValue 없음.
  const body: any = {
    mallId,
    shopTransactionId: txnId(p.shopOrderNo),
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
  return {
    success: true,
    pgTid: j.pgCno || j.pgTid,
    shopOrderNo: j.shopOrderNo || p.shopOrderNo,
    amount: Number(j.amount) || p.amount,
    statusCode: j.statusCode,
    approvedAt: j.transDt || j.approvalDate,
    raw: j,
  };
}

/* =========================================================
   4. 취소·환불 (POST /api/trades/revise) — 일시·정기 공용
   ========================================================= */

export async function cancelPayment(p: {
  pgTid: string;
  amount?: number;
  reviseTypeCode?: string; // 전체취소 기본
  reason?: string;
}): Promise<CancelResult> {
  if (!p.pgTid) return { success: false, errorCode: "MISSING_PG_TID", errorMessage: "pgTid(pgCno)가 없습니다" };
  const { mallId } = getKiccConfig();
  const isPartial = typeof p.amount === "number" && p.amount > 0;
  // kicc.md reviseTypeCode: 40=전체취소 / 32=신용카드 부분취소. (revise는 msgAuthValue 필수·평문 pgCno|shopTransactionId)
  const reviseTypeCode = p.reviseTypeCode || (isPartial ? "32" : "40");
  const shopTransactionId = txnId();
  const body: any = {
    mallId,
    shopTransactionId,
    pgCno: p.pgTid,
    reviseTypeCode,
    cancelReqDate: reqDateYmd(),
    msgAuthValue: signMsgAuth(`${p.pgTid}|${shopTransactionId}`),
    reviseMessage: (p.reason || "관리자 환불").slice(0, 100),
  };
  if (isPartial) body.amount = Math.floor(p.amount as number);
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
    status: j.statusCode || "CANCELED",
    canceledAt: j.transDt || j.reviseDate,
    cancelAmount: Number(j.amount) || p.amount,
    pgTid: j.pgCno || p.pgTid,
    raw: j,
  };
}

/* =========================================================
   5. 빌키 삭제 (POST /api/trades/removeBatchKey)
   ========================================================= */

export async function removeBillingKey(p: {
  billingKey: string;
  shopOrderNo?: string;
}): Promise<{ success: boolean; raw?: any; errorCode?: string; errorMessage?: string }> {
  if (!p.billingKey) return { success: false, errorCode: "MISSING_BILLKEY", errorMessage: "빌키가 없습니다" };
  const { mallId } = getKiccConfig();
  // kicc.md 빌키삭제 필수: mallId·shopTransactionId·batchKey·removeReqDate. msgAuthValue 없음.
  const body: any = {
    mallId,
    shopTransactionId: txnId(p.shopOrderNo),
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
   ========================================================= */

export async function retrieveTransaction(p: {
  shopTransactionId: string;  // 승인/취소 요청 시 사용한 멱등키(= 우리 shopOrderNo)
  transactionDate?: string;   // 요청일자 yyyyMMdd (기본 오늘·전일~당일만 지원)
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
  // kicc.md 조회 필수: mallId·shopTransactionId·transactionDate(yyyyMMdd). msgAuthValue 미제공.
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
   shopOrderNo 생성 (멱등) — 토스 generate*OrderId 이식, pg 비종속
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
   재시도 스케줄 / 청구일 / 연월 — 토스 이식(불변)
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
