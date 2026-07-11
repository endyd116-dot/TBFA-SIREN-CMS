// lib/notify-adapters/sms-aligo.ts
// Phase 9 — Aligo SMS 실연동 어댑터
//
// 이벤트별 메시지:
//   billing.failed          → 결제 실패 단문 (SMS)
//   card.expiring           → 카드 만료 안내 (SMS)
//   기타 이벤트             → params.smsBody 있으면 발송, 없으면 skip (ok=true)
//
// 발신번호 미등록 / 환경변수 누락 상태에서도 코드 머지 가능.
// 실제 발송은 ALIGO_* 환경변수 Netlify 등록 후 자동 활성화.

import { db } from "../../db";
import { members } from "../../db";
import { eq } from "drizzle-orm";
import { aligoSend } from "../aligo-client";
import { NotifyEvent } from "../notify-events";
import type { NotifyAdapter, AdapterSendOpts, AdapterResult } from "./types";
/* 2026-05-16: 어드민 채널 토글 — isActive=false면 발송 차단. */
import { loadEventTemplate } from "../notify-dispatcher";

/* ─── 수신자 전화번호 조회 ─── */
async function lookupPhone(targetId: number): Promise<string | null> {
  try {
    const [row] = await db
      .select({ phone: members.phone })
      .from(members)
      .where(eq(members.id, targetId))
      .limit(1);
    return (row as any)?.phone || null;
  } catch {
    return null;
  }
}

/* ─── 이벤트 → SMS 메시지 빌드 (export — list API 미리보기에서 호출) ─── */
export function buildSmsContent(
  event: NotifyEvent,
  params: Record<string, any>,
): { msg: string; title?: string } | null {
  switch (event) {
    case NotifyEvent.BILLING_FAILED: {
      const name   = String(params.memberName || "후원자");
      const amount = Number(params.amount || 0).toLocaleString("ko-KR");
      const msg    =
        `[SIREN] ${name}님, ${amount}원 결제가 실패했습니다.` +
        ` 마이페이지에서 카드 정보를 확인해 주세요.`;
      return { msg };
    }

    case NotifyEvent.CARD_EXPIRING: {
      const name = String(params.memberName || "후원자");
      const days = params.daysLeft ? `(${params.daysLeft}일 후 만료)` : "";
      const msg  =
        `[SIREN] ${name}님, 등록하신 카드가 곧 만료됩니다${days}.` +
        ` 마이페이지에서 카드를 갱신해 주세요.`;
      return { msg };
    }

    default:
      // 전용 템플릿 없는 이벤트 — params.smsBody 있으면 발송
      if (params.smsBody) {
        return {
          msg:   String(params.smsBody).slice(0, 2000),
          title: params.title ? String(params.title).slice(0, 30) : undefined,
        };
      }
      return null;
  }
}

/* ─── 어댑터 ─── */
export const smsAligoAdapter: NotifyAdapter = {
  channel: "sms",

  async send(opts: AdapterSendOpts): Promise<AdapterResult> {
    const t0 = Date.now();
    try {
      /* 어드민이 SMS 채널 끄면 차단. DB 본문 마이그는 D5 이후 점진. */
      const dbTpl = await loadEventTemplate({ event: opts.event, channel: "sms", params: opts.params });
      if (dbTpl && "skip" in dbTpl) {
        return {
          ok: true,
          providerMessageId: `skipped-admin-disabled-${opts.logId}`,
          latencyMs: Date.now() - t0,
        };
      }

      const phone = await lookupPhone(opts.targetId);
      if (!phone) {
        return {
          ok:        false,
          error:     `전화번호 없음 (targetId=${opts.targetId})`,
          latencyMs: Date.now() - t0,
        };
      }

      const content = buildSmsContent(opts.event, opts.params);
      if (!content) {
        console.log(`[sms-aligo] 이벤트 ${opts.event}에 SMS 템플릿 없음 — skip`);
        return {
          ok:                true,
          providerMessageId: "skipped-no-template",
          latencyMs:         Date.now() - t0,
        };
      }

      const result = await aligoSend({
        receiver: phone,
        msg:      content.msg,
        title:    content.title,
      });

      if (!result.ok) {
        return {
          ok:        false,
          error:     (result.error || `Aligo 오류 code=${result.resultCode}`).slice(0, 500),
          latencyMs: Date.now() - t0,
        };
      }

      return {
        ok:                true,
        providerMessageId: result.msgId,
        latencyMs:         Date.now() - t0,
      };
    } catch (err: any) {
      return {
        ok:        false,
        error:     String(err?.message || err).slice(0, 500),
        latencyMs: Date.now() - t0,
      };
    }
  },
};
