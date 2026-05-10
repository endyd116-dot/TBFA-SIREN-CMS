// lib/notify-adapters/kakao-placeholder.ts
// Phase 8 — 카카오 알림톡 placeholder 어댑터
// 외부 발송 없음 — 발송 로그(sent)만 기록.
// Phase 9에서 카카오 알림톡 API 어댑터(템플릿 ID 매핑 포함)로 교체.

import type { NotifyAdapter, AdapterSendOpts, AdapterResult } from "./types";

export const kakaoPlaceholderAdapter: NotifyAdapter = {
  channel: "kakao",

  async send(opts: AdapterSendOpts): Promise<AdapterResult> {
    const t0 = Date.now();
    console.log(
      `[kakao-placeholder] event=${opts.event} targetId=${opts.targetId} logId=${opts.logId}` +
      " — Phase 9에서 카카오 알림톡 실 발송으로 교체 예정",
    );
    return {
      ok: true,
      providerMessageId: `kakao-placeholder-${opts.logId}`,
      latencyMs: Date.now() - t0,
    };
  },
};
