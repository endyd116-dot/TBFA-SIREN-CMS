// lib/notify-adapters/sms-placeholder.ts
// Phase 8 — SMS placeholder 어댑터
// 외부 발송 없음 — 발송 로그(sent)만 기록.
// Phase 9에서 실 SMS API 어댑터로 교체.

import type { NotifyAdapter, AdapterSendOpts, AdapterResult } from "./types";

export const smsPlaceholderAdapter: NotifyAdapter = {
  channel: "sms",

  async send(opts: AdapterSendOpts): Promise<AdapterResult> {
    const t0 = Date.now();
    console.log(
      `[sms-placeholder] event=${opts.event} targetId=${opts.targetId} logId=${opts.logId}` +
      " — Phase 9에서 실 SMS 발송으로 교체 예정",
    );
    return {
      ok: true,
      providerMessageId: `sms-placeholder-${opts.logId}`,
      latencyMs: Date.now() - t0,
    };
  },
};
