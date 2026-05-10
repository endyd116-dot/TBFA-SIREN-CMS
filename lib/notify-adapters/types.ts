// lib/notify-adapters/types.ts
// Phase 8 — 채널 어댑터 공통 인터페이스 (B·C 채팅 공유 계약)

import type { NotifyEvent, ChannelName } from "../notify-events";

export interface NotifyAdapter {
  channel: ChannelName;
  send(opts: AdapterSendOpts): Promise<AdapterResult>;
}

export interface AdapterSendOpts {
  /** dispatch_logs.id — 상관 관계 추적용 */
  logId: number;
  targetType: "member" | "admin";
  targetId: number;
  event: NotifyEvent;
  /** 템플릿 파라미터 — 이벤트별 필요 필드를 자유롭게 포함 */
  params: Record<string, any>;
}

export interface AdapterResult {
  ok: boolean;
  /** Resend message ID 등 외부 추적 ID */
  providerMessageId?: string;
  latencyMs?: number;
  /** 실패 사유 (500자 이내) */
  error?: string;
}
