/**
 * POST|GET /api/donate-kicc-approve   ← ★ KICC returnUrl 핸들러 (브라우저 복귀 지점)
 *
 * KICC 일시 결제 2단계 — 승인(approval).
 * - KICC가 결제창 인증 후 이 URL로 POST 복귀(authorizationId·shopOrderNo)
 * - register 때 저장한 pending 레코드 로드 → ★ 서버 금액 기준으로 승인
 * - KICC 승인금액 == 등록금액 대조 후 confirmed
 * - 영수증 발급 + 감사 메일 + 포인트 적립
 * - 처리 후 302 redirect → /payment-success.html(성공) / /payment-fail.html(실패)
 *
 * 프론트(A)는 이 API를 직접 호출하지 않음 — success/fail 페이지는 표시 전용.
 */
import { eq } from "drizzle-orm";
import { db, donations } from "../../db";
import { pointRules, memberPointLogs } from "../../db/schema";
import { logUserAction } from "../../lib/audit";
import { sendEmail, tplDonationThanks } from "../../lib/email";
import { checkAndAwardBadges } from "../../lib/badge-checker";
import { approveTrade, kiccPayMethod } from "../../lib/kicc";
import { recalcCampaignStatsSafe } from "../../lib/campaign-stats";

const SITE_URL = (process.env.SITE_URL || "https://tbfa.co.kr").replace(/\/+$/, "");

function redirect(path: string): Response {
  return new Response(null, { status: 302, headers: { Location: `${SITE_URL}${path}`, "Cache-Control": "no-store" } });
}

function failRedirect(reason: string): Response {
  return redirect(`/payment-fail.html?reason=${encodeURIComponent(reason.slice(0, 100))}`);
}

/* KICC 복귀 파라미터 파싱 (form-urlencoded 우선, JSON·쿼리 폴백) */
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

function generateReceiptNumber(donationId: number): string {
  return `TBFA-${new Date().getFullYear()}-${String(donationId).padStart(6, "0")}`;
}

export default async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") return failRedirect("잘못된 접근입니다");

  try {
    const p = await parseReturn(req);
    const authorizationId = p.authorizationId || p.authorizationid || "";
    const pgOrderNo = p.shopOrderNo || p.shoporderno || p.pgOrderNo || "";

    /* KICC 인증 단계 실패(사용자 취소·창 종료 등) */
    if (p.resCd && p.resCd !== "0000") {
      if (pgOrderNo) {
        await db
          .update(donations)
          .set({ status: "failed", failureReason: (p.resMsg || "결제 인증 실패").slice(0, 500), updatedAt: new Date() } as any)
          .where(eq(donations.pgOrderNo, pgOrderNo));
      }
      return failRedirect(p.resMsg || "결제가 취소되었습니다");
    }

    if (!authorizationId || !pgOrderNo) return failRedirect("결제 정보가 누락되었습니다");

    /* pending 레코드 로드 — 서버 신뢰 기준 */
    const [donation] = await db.select().from(donations).where(eq(donations.pgOrderNo, pgOrderNo)).limit(1);
    if (!donation) return failRedirect("주문 정보를 찾을 수 없습니다");

    /* 멱등 — 이미 완료면 그대로 성공 페이지 */
    if (donation.status === "completed") {
      return redirect(`/payment-success.html?donationId=${donation.id}&donationNo=D-${String(donation.id).padStart(7, "0")}`);
    }

    /* KICC 승인 — 응답 금액을 서버(pending) 금액과 대조 */
    const result = await approveTrade({ authorizationId, shopOrderNo: pgOrderNo });

    if (!result.success) {
      await db
        .update(donations)
        .set({ status: "failed", pgTid: result.pgTid, failureReason: (result.errorMessage || "승인 실패").slice(0, 500), updatedAt: new Date() } as any)
        .where(eq(donations.id, donation.id));
      await logUserAction(req, donation.memberId, donation.donorName, "donate_kicc_approve_failed", {
        target: pgOrderNo,
        detail: { code: result.errorCode, message: result.errorMessage },
        success: false,
      });
      return failRedirect(result.errorMessage || "결제 승인에 실패했습니다");
    }

    /* 승인금액 == 등록금액 대조 — ★US-016 fail-closed:
       PG 승인금액이 숫자가 아니거나(누락·NaN) 등록금액과 다르면 거부(이전엔 number일 때만 대조). */
    if (typeof result.amount !== "number" || !Number.isFinite(result.amount) || result.amount !== donation.amount) {
      await db
        .update(donations)
        .set({ status: "failed", pgTid: result.pgTid, failureReason: "승인금액 불일치", updatedAt: new Date() } as any)
        .where(eq(donations.id, donation.id));
      return failRedirect("결제 금액 검증에 실패했습니다");
    }

    /* ★R45 통합 결제창: 실제 선택된 결제수단(카드/간편결제 등) 기록 — register 때 'card' 가정값을 덮어씀 */
    const actualPayMethod = kiccPayMethod(result.payMethodTypeCode, result.cpCode);

    /* ★R45 방어 가드: 가상계좌(입금 대기형)는 즉시승인 흐름과 불일치 — 채번 응답은 금액이 맞아도
       실제 입금 전이라 '완료'로 기록하면 안 됨(입금통보 webhook 미구현). 원장 설정상 노출 안 되게
       하는 게 1차 통제이나, 만일 섞여 들어오면 여기서 pending 유지 후 거절. */
    if (actualPayMethod === "vbank") {
      await db
        .update(donations)
        .set({ payMethod: "vbank", pgTid: result.pgTid, failureReason: "미지원 결제수단(가상계좌)", updatedAt: new Date() } as any)
        .where(eq(donations.id, donation.id));
      return failRedirect("현재 후원은 카드·간편결제만 지원합니다");
    }

    /* 확정 */
    const now = new Date();
    const receiptNumber = generateReceiptNumber(donation.id);
    const [updated] = await db
      .update(donations)
      .set({
        status: "completed",
        payMethod: actualPayMethod,
        pgTid: result.pgTid,
        transactionId: result.pgTid,
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
        type: donations.type,
        payMethod: donations.payMethod,
        memberId: donations.memberId,
        receiptNumber: donations.receiptNumber,
      });

    /* 감사 메일 (실패해도 결제는 성공) */
    let emailSent = false;
    try {
      if (updated.donorEmail) {
        const tpl = tplDonationThanks({
          donorName: updated.donorName,
          amount: updated.amount,
          donationType: updated.type as string,
          payMethod: updated.payMethod || "card",
          donationId: updated.id,
          donationDate: now,
          isMember: !!updated.memberId,
        });
        const m = await sendEmail({ to: updated.donorEmail, subject: tpl.subject, html: tpl.html });
        emailSent = !!m.ok;
      }
    } catch (e) {
      console.error("[donate-kicc-approve] 메일 예외:", e);
    }

    /* 포인트 적립 (fire-and-forget) */
    try {
      const [rule] = await db.select().from(pointRules).where(eq(pointRules.eventType, "donation_complete")).limit(1);
      if (rule && rule.isActive && updated.memberId) {
        const pts = Math.floor(updated.amount / 10000) * rule.pointAmount;
        if (pts > 0) {
          await db.insert(memberPointLogs).values({
            memberId: updated.memberId,
            delta: pts,
            reason: "후원 완료",
            eventType: "donation_complete",
            referenceId: updated.id,
          } as any);
          await checkAndAwardBadges(updated.memberId);
        }
      }
    } catch (e) {
      console.warn("[donate-kicc-approve] 포인트 적립 실패", e);
    }

    /* ★ US-044: 캠페인 지정 후원이면 모금현황(모금액·후원자수) 즉시 재계산 */
    await recalcCampaignStatsSafe((donation as any).campaignId);

    await logUserAction(req, updated.memberId, updated.donorName, "donate_kicc_approve_success", {
      target: pgOrderNo,
      detail: { donationId: updated.id, amount: updated.amount, pgTid: result.pgTid, receiptNumber, emailSent },
    });

    return redirect(`/payment-success.html?donationId=${updated.id}&donationNo=D-${String(updated.id).padStart(7, "0")}`);
  } catch (err) {
    console.error("[donate-kicc-approve]", err);
    return failRedirect("결제 처리 중 오류가 발생했습니다");
  }
};

export const config = { path: "/api/donate-kicc-approve" };
