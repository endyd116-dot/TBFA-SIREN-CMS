// lib/notify-adapters/email.ts
// Phase 8 — 이메일 어댑터 (lib/email.ts Resend 래핑 + event → 템플릿 매핑)
// 이벤트별 전용 템플릿 없을 경우: params.title + params.emailBody 로 일반 메일 발송.
// 템플릿도 없고 일반 body도 없으면 skip (ok=true, skipped).

import { db, members } from "../../db";
import { eq } from "drizzle-orm";
import {
  sendEmail,
  tplBillingChargeSuccess,
  tplBillingChargeFailed,
  tplSupportAnsweredUser,
  tplMemberApproved,
  tplMemberRejected,
} from "../email";
import { NotifyEvent } from "../notify-events";
import type { NotifyAdapter, AdapterSendOpts, AdapterResult } from "./types";
/* 2026-05-16: 자동 발송 통합 CMS — 운영자가 어드민에서 이벤트 끄면 발송 차단. */
import { loadEventTemplate } from "../notify-dispatcher";

/* ─── 수신자 이메일 조회 (members 테이블 통합 — user·admin 모두) ─── */
async function lookupEmail(targetId: number): Promise<string | null> {
  try {
    const [row] = await db
      .select({ email: members.email })
      .from(members)
      .where(eq(members.id, targetId))
      .limit(1);
    return (row as any)?.email || null;
  } catch {
    return null;
  }
}

/* ─── 이벤트 → 이메일 템플릿 라우팅 (export — list API 미리보기에서 호출) ─── */
export function buildEmailContent(
  event: NotifyEvent,
  params: Record<string, any>,
): { subject: string; html: string } | null {
  switch (event) {
    case NotifyEvent.BILLING_SUCCESS:
      return tplBillingChargeSuccess({
        donorName:        params.memberName          || "후원자",
        amount:           Number(params.amount)      || 0,
        donationId:       Number(params.donationId)  || 0,
        chargedAt:        params.chargedAt   ? new Date(params.chargedAt)   : new Date(),
        nextChargeAt:     params.nextChargeAt ? new Date(params.nextChargeAt) : new Date(),
        cardCompany:      params.cardCompany      || "",
        cardNumberMasked: params.cardNumberMasked || "",
        isMember:         params.isMember !== false,
      });

    case NotifyEvent.BILLING_FAILED:
      return tplBillingChargeFailed({
        donorName:            params.memberName || "후원자",
        amount:               Number(params.amount) || 0,
        failureReason:        params.failureReason        || "결제 실패",
        consecutiveFailCount: Number(params.consecutiveFailCount) || 1,
        willRetryAt:          params.willRetryAt ? new Date(params.willRetryAt) : undefined,
        isMember:             params.isMember !== false,
      });

    case NotifyEvent.SUPPORT_REPLY:
      return tplSupportAnsweredUser({
        applicantName: params.memberName || "신청자",
        requestNo:     params.requestNo  || "",
        title:         params.title      || "",
        newStatus:     params.newStatus  || "answered",
      });

    case NotifyEvent.MEMBER_ELIGIBILITY_DECIDED:
      if (params.approved) {
        return tplMemberApproved({
          userName:      params.memberName   || "신청자",
          memberSubtype: params.memberSubtype || "family",
          approvedAt:    params.decidedAt ? new Date(params.decidedAt) : new Date(),
        });
      } else {
        return tplMemberRejected({
          userName:       params.memberName   || "신청자",
          memberSubtype:  params.memberSubtype || "family",
          rejectedReason: params.rejectedReason || "증빙 서류 미비",
          rejectedAt:     params.decidedAt ? new Date(params.decidedAt) : new Date(),
        });
      }

    default:
      // 전용 템플릿 없는 이벤트 — params.title + params.emailBody 로 일반 메일
      if (params.title && params.emailBody) {
        return {
          subject: String(params.title),
          html: `<div style="font-family:sans-serif;color:#0f0f0f;padding:24px;line-height:1.7;">${String(params.emailBody).slice(0, 10000)}</div>`,
        };
      }
      return null;
  }
}

/* ─── 어댑터 ─── */
export const emailAdapter: NotifyAdapter = {
  channel: "email",

  async send(opts: AdapterSendOpts): Promise<AdapterResult> {
    const t0 = Date.now();
    try {
      /* 어드민 채널 토글 확인 — DB 본문 우선, 없으면 폴백, isActive=false면 차단 */
      const dbTpl = await loadEventTemplate({ event: opts.event, channel: "email", params: opts.params });
      if (dbTpl && "skip" in dbTpl) {
        return {
          ok: true,
          providerMessageId: `skipped-admin-disabled-${opts.logId}`,
          latencyMs: Date.now() - t0,
        };
      }

      const email = await lookupEmail(opts.targetId);
      if (!email) {
        return {
          ok: false,
          error: `이메일 주소 없음 (targetId=${opts.targetId})`,
          latencyMs: Date.now() - t0,
        };
      }

      /* DB 템플릿이 있으면 그걸로, 없으면 기존 하드코딩 tpl* 함수로 폴백 */
      const tpl = (dbTpl && !("skip" in dbTpl))
        ? { subject: dbTpl.subject, html: dbTpl.body }
        : buildEmailContent(opts.event, opts.params);
      if (!tpl) {
        // 이벤트에 대응 템플릿 없음 — 실패 아닌 스킵
        console.log(`[email-adapter] 이벤트 ${opts.event}에 이메일 템플릿 없음 — skip`);
        return {
          ok: true,
          providerMessageId: "skipped-no-template",
          latencyMs: Date.now() - t0,
        };
      }

      const result = await sendEmail({ to: email, ...tpl });

      if (!(result as any).ok) {
        return {
          ok: false,
          error: String(
            (result as any).error?.message ||
            (result as any).error ||
            "이메일 발송 실패",
          ).slice(0, 500),
          latencyMs: Date.now() - t0,
        };
      }

      return {
        ok: true,
        providerMessageId: (result as any).id || undefined,
        latencyMs: Date.now() - t0,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: String(err?.message || err).slice(0, 500),
        latencyMs: Date.now() - t0,
      };
    }
  },
};
