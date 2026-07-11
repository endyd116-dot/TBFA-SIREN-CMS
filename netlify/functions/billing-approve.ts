/**
 * POST|GET /api/billing-approve   ← KICC returnUrl 핸들러 (정기 빌키 등록 복귀 지점)
 *
 * KICC 정기 후원 2단계 — 빌키 발급(approval) + 1회차 즉시결제(approval/batch).
 * - KICC가 빌키 등록창 인증 후 이 URL로 POST 복귀(authorizationId·shopOrderNo)
 * - register 때 저장한 pending(type=regular) 로드 → 서버 금액 기준
 * - 발급 승인 → 빌키 회신 → billing_keys 저장 → 빌키로 1회차 청구
 * - 영수증 + 감사 메일 + 등급 재계산 + donor_type 재평가
 * - 처리 후 302 redirect → /billing-success.html(성공) / /payment-fail.html(실패)
 *
 * 프론트(A)는 이 API를 직접 호출하지 않음 — success/fail 페이지는 표시 전용.
 */
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";
import { db, billingKeys, donations } from "../../db";
import { logUserAction } from "../../lib/audit";
import { sendEmail, tplDonationThanks } from "../../lib/email";
import { recalculateGrade } from "../../lib/grade-calculator";
import { safeReevaluate } from "../../lib/donor-status";
import { approveTrade, chargeWithBillingKey, calculateNextBillingDate } from "../../lib/kicc";
import { dispatch } from "../../lib/notify-dispatcher";
import { NotifyEvent } from "../../lib/notify-events";
import { notifyAllSuperAdmins, notifyAllOperators } from "../../lib/notify";

const SITE_URL = (process.env.SITE_URL || "https://tbfa.co.kr").replace(/\/+$/, "");

function redirect(path: string): Response {
  return new Response(null, { status: 302, headers: { Location: `${SITE_URL}${path}`, "Cache-Control": "no-store" } });
}
function failRedirect(reason: string): Response {
  return redirect(`/payment-fail.html?reason=${encodeURIComponent(reason.slice(0, 100))}`);
}
function successRedirect(donationId: number): Response {
  return redirect(`/billing-success.html?donationId=${donationId}&donationNo=D-${String(donationId).padStart(7, "0")}`);
}

async function parseReturn(req: Request): Promise<Record<string, string>> {
  const obj: Record<string, string> = {};
  const url = new URL(req.url);
  for (const [k, val] of url.searchParams) obj[k] = val;
  if (req.method === "POST") {
    const ct = req.headers.get("content-type") || "";
    const raw = await req.text().catch(() => "");
    if (raw) {
      if (ct.includes("application/json")) {
        try {
          Object.assign(obj, JSON.parse(raw));
        } catch {
          /* noop */
        }
      } else {
        for (const [k, val] of new URLSearchParams(raw)) obj[k] = val;
      }
    }
  }
  return obj;
}

function generateCustomerKey(memberId: number | null): string {
  const rand = crypto.randomBytes(memberId ? 4 : 8).toString("hex");
  return memberId ? `M${memberId}-${rand}` : `G-${rand}`;
}
function generateReceiptNumber(donationId: number): string {
  return `TBFA-${new Date().getFullYear()}-${String(donationId).padStart(6, "0")}`;
}

export default async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") return failRedirect("잘못된 접근입니다");

  try {
    const p = await parseReturn(req);
    const authorizationId = p.authorizationId || p.authorizationid || "";
    const pgOrderNo = p.shopOrderNo || p.shoporderno || p.pgOrderNo || "";

    if (p.resCd && p.resCd !== "0000") {
      if (pgOrderNo) {
        await db
          .update(donations)
          .set({ status: "failed", failureReason: (p.resMsg || "빌키 등록 인증 실패").slice(0, 500), updatedAt: new Date() } as any)
          .where(eq(donations.pgOrderNo, pgOrderNo));
      }
      return failRedirect(p.resMsg || "정기 후원 등록이 취소되었습니다");
    }
    if (!authorizationId || !pgOrderNo) return failRedirect("결제 정보가 누락되었습니다");

    /* pending(type=regular) 로드 — 서버 신뢰 기준 */
    const [donation] = await db.select().from(donations).where(eq(donations.pgOrderNo, pgOrderNo)).limit(1);
    if (!donation) return failRedirect("주문 정보를 찾을 수 없습니다");
    if (donation.status === "completed") return successRedirect(donation.id);

    const memberId: number | null = donation.memberId ?? null;
    const amount = donation.amount;

    /* 회원 1인당 활성 빌키 1개 — 재확인(중복 제출 방지) */
    if (memberId) {
      const [activeKey] = await db
        .select({ id: billingKeys.id })
        .from(billingKeys)
        .where(and(eq(billingKeys.memberId, memberId), eq(billingKeys.isActive, true)))
        .limit(1);
      if (activeKey) return successRedirect(donation.id);
    }

    /* 1) 빌키 발급 승인 */
    const issue = await approveTrade({ authorizationId, shopOrderNo: pgOrderNo });
    if (!issue.success || !issue.billKey) {
      await db
        .update(donations)
        .set({ status: "failed", failureReason: (issue.errorMessage || "빌키 발급 실패").slice(0, 500), updatedAt: new Date() } as any)
        .where(eq(donations.id, donation.id));
      await logUserAction(req, memberId, donation.donorName, "billing_issue_failed", {
        target: pgOrderNo,
        detail: { code: issue.errorCode, message: issue.errorMessage },
        success: false,
      });
      return failRedirect(issue.errorMessage || "카드 등록에 실패했습니다");
    }

    const billKey = issue.billKey;
    const cardCompany = issue.cardCompany || "카드";
    const cardNumberMasked = issue.cardNumberMasked || "****-****-****-****";
    const cardType = issue.cardType === "체크" ? "체크" : "신용";

    /* 2) 빌키로 1회차 즉시결제
       R41 Q1-002 FIX: 1회차 주문번호를 pending 주문(pgOrderNo) 기반 결정값으로.
       이전엔 generateShopOrderNo(랜덤)이라 KICC 복귀(returnUrl) 중복 수신·재시도 시
       매번 다른 거래로 인식 → 첫 회차 이중청구 가능. 이제 같은 등록건은 같은
       shopOrderNo → KICC shopTransactionId 멱등으로 1회만 청구. */
    const chargeOrderNo = `${pgOrderNo}-B1`;
    const charge = await chargeWithBillingKey({
      billingKey: billKey,
      shopOrderNo: chargeOrderNo,
      amount,
      goodsName: "교사유가족협의회 정기 후원 (1회차)",
      customerName: donation.donorName,
      customerEmail: donation.donorEmail || undefined,
    });

    if (!charge.success) {
      /* 빌키는 발급됐으나 첫 결제 실패 → 비활성 빌키로 기록 + donation failed */
      let custKey = "";
      for (let i = 0; i < 3; i++) {
        custKey = generateCustomerKey(memberId);
        const [dup] = await db.select({ id: billingKeys.id }).from(billingKeys).where(eq(billingKeys.customerKey, custKey)).limit(1);
        if (!dup) break;
      }
      await db
        .insert(billingKeys)
        .values({
          memberId: memberId ?? undefined,
          billingKey: billKey,
          customerKey: custKey,
          pgProvider: "kicc",
          cardCompany,
          cardNumberMasked,
          cardType,
          amount,
          isActive: false,
          consecutiveFailCount: 1,
          lastFailureReason: (charge.errorMessage || "첫 결제 실패").slice(0, 500),
          deactivatedAt: new Date(),
          deactivatedReason: "first_charge_failed",
        } as any)
        .catch(() => {});
      await db
        .update(donations)
        .set({ status: "failed", failureReason: (charge.errorMessage || "첫 결제 실패").slice(0, 500), updatedAt: new Date() } as any)
        .where(eq(donations.id, donation.id));
      await logUserAction(req, memberId, donation.donorName, "billing_first_charge_failed", {
        target: pgOrderNo,
        detail: { code: charge.errorCode, message: charge.errorMessage, amount },
        success: false,
      });
      /* US-014: 첫 회차 결제 실패 시 후원자·운영진 알림 (기존엔 알림 0·후속 안내 없음).
         후원자는 정기후원이 시작됐는지 알 수 없었고 협회도 실패를 인지 못했음. */
      if (memberId) {
        try {
          dispatch({
            event: NotifyEvent.BILLING_FAILED,
            target: { type: "member", id: memberId },
            params: {
              memberName: donation.donorName,
              amount,
              title: "정기후원 첫 결제 실패",
              message: "카드 등록은 완료되었으나 첫 회차 결제가 실패했습니다. 마이페이지에서 다시 등록을 시도해 주세요.",
              link: "/billing-register.html",
              category: "donation",
              severity: "warning",
            },
          });
        } catch (e) { console.warn("[billing-approve] 첫결제실패 후원자 알림 예외(무시):", e); }
      }
      try {
        await notifyAllSuperAdmins({
          category: "donation",
          severity: "warning",
          title: "정기후원 첫 회차 결제 실패",
          message: `${donation.donorName}님의 정기후원 첫 회차 결제가 실패했습니다 (${charge.errorMessage || "사유 미상"}).`,
          link: "/admin.html#donations",
          refTable: "donations",
          refId: donation.id,
        });
      } catch (e) { console.warn("[billing-approve] 첫결제실패 운영진 알림 예외(무시):", e); }
      return failRedirect(charge.errorMessage || "첫 결제에 실패했습니다");
    }

    /* 3) billing_keys INSERT (활성) */
    const now = new Date();
    /* 2026-06-27 FIX: 월말(29~31일) 가입자 첫 정기청구가 한 달 건너뛰던 버그.
       단순 +1달(addMonth)은 1/31→3/3로 2월을 건너뜀 → 월말 보정된 calculateNextBillingDate 사용. */
    const nextCharge = calculateNextBillingDate(now.getDate(), now);
    let customerKey = "";
    for (let i = 0; i < 3; i++) {
      customerKey = generateCustomerKey(memberId);
      const [dup] = await db.select({ id: billingKeys.id }).from(billingKeys).where(eq(billingKeys.customerKey, customerKey)).limit(1);
      if (!dup) break;
    }
    const [insertedBilling] = await db
      .insert(billingKeys)
      .values({
        memberId: memberId ?? undefined,
        billingKey: billKey,
        customerKey,
        pgProvider: "kicc",
        cardCompany,
        cardNumberMasked,
        cardType,
        amount,
        isActive: true,
        nextChargeAt: nextCharge,
        lastChargedAt: now,
        consecutiveFailCount: 0,
      } as any)
      .returning({ id: billingKeys.id });

    /* 4) pending donation → completed (첫 결제) */
    const receiptNumber = generateReceiptNumber(donation.id);
    const [updated] = await db
      .update(donations)
      .set({
        status: "completed",
        pgTid: charge.pgTid,
        transactionId: charge.pgTid,
        billingKeyId: insertedBilling.id,
        receiptIssued: true,
        receiptIssuedAt: now,
        receiptNumber,
        receiptRequested: true,
        paidAt: now,
        updatedAt: now,
      } as any)
      .where(eq(donations.id, donation.id))
      .returning({
        id: donations.id,
        donorName: donations.donorName,
        donorEmail: donations.donorEmail,
        amount: donations.amount,
        memberId: donations.memberId,
      });

    /* 5) members 약정일·다음청구일 (회원만) */
    if (memberId) {
      try {
        await db.execute(sql`
          UPDATE members
          SET billing_day = ${now.getDate()},
              next_billing_date = ${nextCharge.toISOString().slice(0, 10)}::date,
              updated_at = NOW()
          WHERE id = ${memberId}
        `);
      } catch (e) {
        console.warn("[billing-approve] members 약정일 갱신 실패(무시):", e);
      }
    }

    /* 6) 감사 메일 */
    try {
      const tpl = tplDonationThanks({
        donorName: updated.donorName,
        amount: updated.amount,
        donationType: "regular",
        payMethod: "card",
        donationId: updated.id,
        donationDate: now,
        isMember: !!updated.memberId,
      });
      await sendEmail({ to: updated.donorEmail || donation.donorEmail || "", subject: tpl.subject, html: tpl.html });
    } catch (e) {
      console.error("[billing-approve] 메일 예외:", e);
    }

    /* 7) 등급 재계산 + donor_type 재평가 (fire-and-forget) */
    if (memberId) {
      try {
        await recalculateGrade(memberId);
      } catch (e) {
        console.error("[billing-approve] 등급 재계산 실패:", e);
      }
    }
    await safeReevaluate(memberId, "billing-approve");

    /* 운영자 인앱 알림 (2026-07-01) */
    try {
      await notifyAllOperators({
        category: "donation",
        severity: "info",
        title: "새 정기후원",
        message: `방금 새 정기후원이 시작됐어요. ${updated.donorName}님 월 ${Number(updated.amount).toLocaleString()}원 — 확인해 보세요.`,
        link: "/admin.html#donations",
        refTable: "donations",
        refId: updated.id,
      }, { category: "donation" });
    } catch (e) { console.warn("[billing-approve] 운영자 인앱 알림 예외(무시):", e); }

    /* 운영자 카카오 알림톡 (승인 템플릿 있을 때만·no-op 안전) */
    try {
      const { sendOperatorAlimtalk, OPERATOR_KAKAO_EVENT_KEYS } = await import("../../lib/notify-operator-kakao");
      await sendOperatorAlimtalk(OPERATOR_KAKAO_EVENT_KEYS.DONATION, {
        금액: Number(updated.amount).toLocaleString(),
        이름: String(updated.donorName || ""),
      });
    } catch (e) { console.warn("[billing-approve] 운영자 알림톡 예외(무시):", e); }

    await logUserAction(req, memberId, updated.donorName, "billing_register_success", {
      target: pgOrderNo,
      detail: { billingKeyId: insertedBilling.id, donationId: updated.id, amount, cardCompany, cardNumberMasked, nextChargeAt: nextCharge.toISOString() },
    });

    /* 8) 후원 정보 변경 알림 — 이전 빌키가 있던 회원의 재등록(카드/금액 변경) 시에만 (첫 등록은 제외) */
    if (memberId) {
      try {
        const prior: any = await db.execute(sql`
          SELECT COUNT(*)::int AS n FROM billing_keys WHERE member_id = ${memberId} AND id <> ${insertedBilling.id}`);
        const hadPrior = Number((prior?.rows ?? prior ?? [])[0]?.n) > 0;
        if (hadPrior) {
          dispatch({
            event: NotifyEvent.DONOR_INFO_CHANGED,
            target: { type: "member", id: memberId },
            params: {
              memberName: updated.donorName,
              changeField: "결제 카드",
              changeValue: `${cardCompany} ${cardNumberMasked} · 월 ${Number(amount).toLocaleString()}원`,
              changedAt: now,
              title: "후원 정보 변경 처리 완료",
              message: "후원 결제 정보가 변경되었습니다.",
              link: "/mypage.html",
              category: "donation",
              severity: "info",
            },
          });
        }
      } catch (e) {
        console.warn("[billing-approve] 후원변경 알림 예외(무시):", e);
      }
    }

    return successRedirect(updated.id);
  } catch (err) {
    console.error("[billing-approve]", err);
    return failRedirect("정기 후원 등록 중 오류가 발생했습니다");
  }
};

export const config = { path: "/api/billing-approve" };
