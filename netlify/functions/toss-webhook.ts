/**
 * POST /api/toss-webhook
 *
 * 토스페이먼츠 webhook 수신 (서버 측만 호출됨)
 * - 토스가 결제 결과를 비동기로 알려줌
 * - confirm API와 별개로 동작 (이중 안전장치)
 *
 * 지원 이벤트:
 * - PAYMENT_STATUS_CHANGED: 결제 상태 변경 (DONE/CANCELED/EXPIRED 등)
 * - DEPOSIT_CALLBACK: 가상계좌 입금 알림 (현재 미사용)
 *
 * 보안:
 * - 서명 검증 (TossPayments-Signature 헤더 — HMAC-SHA256)
 * - 시크릿 키는 서버 측만 보유
 * - 외부 호출 불가 (서명 없으면 거부)
 *
 * 멱등성:
 * - 이미 처리된 paymentKey + status면 무시
 * - 동일 webhook이 여러 번 와도 안전
 *
 * 토스 webhook 재시도 정책:
 * - 우리가 200 응답하지 않으면 토스가 최대 3회 재시도
 * - 따라서 빠르게 200 반환 + 비동기 처리 권장
 */
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { db, donations, billingKeys } from "../../db";
import {
  ok, badRequest, unauthorized, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

const TOSS_MODE = (process.env.TOSS_MODE || "test").toLowerCase();
const TOSS_SECRET_KEY =
  TOSS_MODE === "live"
    ? (process.env.TOSS_LIVE_SECRET_KEY || "")
    : (process.env.TOSS_TEST_SECRET_KEY || "");

/* ───────── 서명 검증 ───────── */
function verifyTossSignature(rawBody: string, signature: string): boolean {
  if (!TOSS_SECRET_KEY || !signature) return false;

  try {
    /* 토스 서명 형식: HMAC-SHA256(secretKey, rawBody) → base64 */
    const expected = crypto
      .createHmac("sha256", TOSS_SECRET_KEY)
      .update(rawBody, "utf8")
      .digest("base64");

    /* 타이밍 공격 방어 — 길이 다르면 즉시 false */
    if (signature.length !== expected.length) return false;

    /* 상수 시간 비교 */
    return crypto.timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expected, "utf8"),
    );
  } catch (e) {
    console.error("[toss-webhook] 서명 검증 예외:", e);
    return false;
  }
}

/* ───────── PAYMENT_STATUS_CHANGED 처리 ───────── */
async function handlePaymentStatusChanged(payload: any) {
  const data = payload.data || payload;
  const paymentKey: string = data.paymentKey;
  const orderId: string = data.orderId;
  const status: string = data.status; // DONE, CANCELED, PARTIAL_CANCELED, ABORTED, EXPIRED, IN_PROGRESS, WAITING_FOR_DEPOSIT

  if (!paymentKey || !status) {
    console.warn("[toss-webhook] PAYMENT_STATUS_CHANGED 필수 필드 누락:", { paymentKey, status });
    return { processed: false, reason: "missing_fields" };
  }

  /* paymentKey로 donations 조회 (없으면 orderId fallback) */
  let donation: any = null;
  const [byPayKey] = await db
    .select()
    .from(donations)
    .where(eq(donations.tossPaymentKey, paymentKey))
    .limit(1);
  donation = byPayKey;

  if (!donation && orderId) {
    const [byOrderId] = await db
      .select()
      .from(donations)
      .where(eq(donations.tossOrderId, orderId))
      .limit(1);
    donation = byOrderId;
  }

  if (!donation) {
    console.warn(`[toss-webhook] donation 미발견: paymentKey=${paymentKey}, orderId=${orderId}`);
    return { processed: false, reason: "donation_not_found" };
  }

  /* 토스 status → 우리 status 매핑 */
  const statusMap: Record<string, string> = {
    DONE: "completed",
    CANCELED: "cancelled",
    PARTIAL_CANCELED: "refunded",
    ABORTED: "failed",
    EXPIRED: "failed",
    WAITING_FOR_DEPOSIT: "pending",
    IN_PROGRESS: "pending",
  };

  const newStatus = statusMap[status];
  if (!newStatus) {
    console.warn(`[toss-webhook] 알 수 없는 status: ${status}`);
    return { processed: false, reason: "unknown_status" };
  }

  /* 멱등성: 이미 같은 상태면 무시 */
  if (donation.status === newStatus) {
    console.log(`[toss-webhook] 중복 webhook (이미 ${newStatus}): donationId=${donation.id}`);
    return { processed: true, idempotent: true, donationId: donation.id };
  }

  /* 우리 시스템에서 이미 더 진전된 상태면 webhook 무시
     예: 우리는 이미 completed인데 토스가 IN_PROGRESS 보내면 무시 */
  const statusPriority: Record<string, number> = {
    pending: 1,
    completed: 2,
    failed: 3,
    cancelled: 4,
    refunded: 5,
  };
  const currentPriority = statusPriority[donation.status] || 0;
  const newPriority = statusPriority[newStatus] || 0;

  /* 단, completed → cancelled/refunded는 허용 (관리자 환불 등) */
  const isDowngradeAllowed =
    (donation.status === "completed" && (newStatus === "cancelled" || newStatus === "refunded"));

  if (currentPriority > newPriority && !isDowngradeAllowed) {
    console.log(`[toss-webhook] 우리 status가 더 진전됨 (무시): ${donation.status} → ${newStatus}`);
    return { processed: true, idempotent: true, reason: "already_advanced" };
  }

  /* DB 업데이트 */
  const updatePayload: any = {
    status: newStatus,
    updatedAt: new Date(),
  };

  /* 상태별 추가 필드 */
  if (newStatus === "completed") {
    /* DONE webhook이 confirm보다 먼저 도착할 수 있음 — 영수증 등은 confirm에서 처리 */
    if (!donation.tossPaymentKey) {
      updatePayload.tossPaymentKey = paymentKey;
      updatePayload.transactionId = paymentKey;
    }
  } else if (newStatus === "failed") {
    updatePayload.tossPaymentKey = paymentKey;
    updatePayload.failureReason = (data.failure?.message || data.message || `토스 webhook: ${status}`).slice(0, 500);
  } else if (newStatus === "cancelled" || newStatus === "refunded") {
    /* 환불 사유 메모에 추가 */
    const cancelMemo = `[토스 webhook ${new Date().toISOString().slice(0, 10)} ${status}] ${data.cancels?.[0]?.cancelReason || data.message || ""}`.slice(0, 200);
    const newMemo = donation.memo
      ? `${donation.memo}\n${cancelMemo}`
      : cancelMemo;
    updatePayload.memo = newMemo;
  }

  await db
    .update(donations)
    .set(updatePayload)
    .where(eq(donations.id, donation.id));

  await logAudit({
    userId: donation.memberId,
    userType: "system",
    userName: "toss-webhook",
    action: `webhook_payment_${newStatus}`,
    target: orderId || donation.tossOrderId || `D-${donation.id}`,
    detail: {
      donationId: donation.id,
      previousStatus: donation.status,
      newStatus,
      tossStatus: status,
      paymentKey,
    },
  });

  return { processed: true, donationId: donation.id, newStatus };
}

/* ───────── 메인 핸들러 ───────── */
export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 환경변수 검증 */
    if (!TOSS_SECRET_KEY) {
      console.error("[toss-webhook] TOSS_SECRET_KEY 미설정");
      return serverError("결제 시스템 설정 오류");
    }

    /* 2. raw body 읽기 (서명 검증용) */
    const rawBody = await req.text();
    if (!rawBody) {
      return badRequest("요청 본문이 비어있습니다");
    }

    /* 3. 서명 검증 */
    const signature = req.headers.get("tosspayments-signature") || "";

    if (!signature) {
      console.warn("[toss-webhook] 서명 헤더 누락");
      /* 테스트 환경에서는 서명 없어도 통과 (토스 대시보드 테스트 호출 대응) */
      if (TOSS_MODE !== "test") {
        return unauthorized("서명이 필요합니다");
      }
    } else {
      const valid = verifyTossSignature(rawBody, signature);
      if (!valid) {
        console.warn("[toss-webhook] 서명 검증 실패");
        await logAudit({
          userType: "system",
          userName: "toss-webhook",
          action: "webhook_signature_invalid",
          detail: {
            signaturePrefix: signature.slice(0, 10),
            bodyPrefix: rawBody.slice(0, 100),
          },
          success: false,
        });
        return unauthorized("서명 검증 실패");
      }
    }

    /* 4. JSON 파싱 */
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      return badRequest("잘못된 JSON 형식");
    }

    const eventType: string = payload.eventType || payload.event || "";

    /* 5. 이벤트별 분기 */
    let result: any = { processed: false, reason: "unsupported_event" };

    switch (eventType) {
      case "PAYMENT_STATUS_CHANGED":
      case "PAYMENT.STATUS_CHANGED":
        result = await handlePaymentStatusChanged(payload);
        break;

      case "DEPOSIT_CALLBACK":
      case "DEPOSIT.CALLBACK":
        /* 가상계좌 입금 알림 — 현재 미사용 */
        console.log("[toss-webhook] DEPOSIT_CALLBACK 수신 (미처리):", payload);
        result = { processed: false, reason: "deposit_not_implemented" };
        break;

      default:
        console.warn(`[toss-webhook] 알 수 없는 eventType: ${eventType}`);
        await logAudit({
          userType: "system",
          userName: "toss-webhook",
          action: "webhook_unknown_event",
          detail: { eventType, payloadKeys: Object.keys(payload) },
        });
        result = { processed: false, reason: "unknown_event", eventType };
    }

    /* 6. 항상 200 응답 (토스 재시도 방지) */
    /* — 처리 실패해도 200 반환하지 않으면 토스가 무한 재시도 */
    return ok(result, "webhook 수신 완료");
  } catch (err: any) {
    console.error("[toss-webhook] 전체 예외:", err);
    /* 예외 발생해도 200 반환 (재시도 방지) — 단, 로그는 남김 */
    await logAudit({
      userType: "system",
      userName: "toss-webhook",
      action: "webhook_exception",
      detail: { error: err?.message?.slice(0, 500) },
      success: false,
    }).catch(() => {});

    return ok({
      processed: false,
      error: "internal_error",
    }, "처리 중 오류 (재시도 방지)");
  }
};

export const config = { path: "/api/toss-webhook" };