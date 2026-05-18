// lib/notify-events.ts
// Phase 8 — 알림 이벤트 카탈로그 & 기본 채널 정책
// B·C 채팅도 이 파일의 enum 만 참조 (인터페이스 단일 출처)

/* =========================================================
   이벤트 카탈로그 (9종 확정)
   ========================================================= */

export enum NotifyEvent {
  BILLING_SUCCESS             = "billing.success",
  BILLING_FAILED              = "billing.failed",
  BILLING_CANCELED            = "billing.canceled",
  CARD_EXPIRING               = "card.expiring",
  WORKSPACE_ACTIVITY          = "workspace.activity",
  WORKSPACE_MENTION           = "workspace.mention",
  ADMIN_DAILY_BRIEFING        = "admin.daily_briefing",
  SUPPORT_REPLY               = "support.reply",
  SIREN_ASSIGNED              = "siren.assigned",
  MEMBER_ELIGIBILITY_DECIDED  = "member.eligibility_decided",
  COMMENT_REPORT_RESOLVED     = "comment.report_resolved",
  LEGAL_ASSIGNED              = "legal.assigned",
}

export type ChannelName = "inapp" | "email" | "sms" | "kakao";

/* =========================================================
   기본 채널 정책 (Phase 8)
   - sms: 현재 미사용 (Phase 9 에서 추가 예정)
   - kakao '✓ (placeholder)': 발송 로그 기록만 됨, 실제 메시지 외부 전달 X
     Phase 9에서 카카오 알림톡 API 어댑터로 교체.
   ========================================================= */

/* =========================================================
   강제 채널 (사용자가 해제 불가 — 결제·법적 의무 알림)
   Phase 9-B: UI에서 disabled 처리, 디스패처에서 항상 포함
   ========================================================= */
export const FORCED_CHANNELS: Partial<Record<NotifyEvent, ChannelName[]>> = {
  [NotifyEvent.BILLING_FAILED]:  ["inapp", "email"],
  [NotifyEvent.CARD_EXPIRING]:   ["inapp", "email"],
};

export const EVENT_CHANNEL_POLICY: Record<NotifyEvent, ChannelName[]> = {
  [NotifyEvent.BILLING_SUCCESS]:            ["inapp", "email"],
  [NotifyEvent.BILLING_FAILED]:             ["inapp", "email", "sms", "kakao"],  // sms: Aligo / kakao: placeholder
  [NotifyEvent.BILLING_CANCELED]:           ["inapp", "email"],
  [NotifyEvent.CARD_EXPIRING]:              ["inapp", "email", "sms", "kakao"],  // sms: Aligo / kakao: placeholder
  [NotifyEvent.WORKSPACE_ACTIVITY]:         ["inapp"],
  [NotifyEvent.WORKSPACE_MENTION]:          ["inapp"],
  [NotifyEvent.ADMIN_DAILY_BRIEFING]:       ["email"],
  [NotifyEvent.SUPPORT_REPLY]:              ["inapp", "email"],
  [NotifyEvent.SIREN_ASSIGNED]:             ["inapp", "email"],
  [NotifyEvent.MEMBER_ELIGIBILITY_DECIDED]: ["inapp", "email"],
  [NotifyEvent.COMMENT_REPORT_RESOLVED]:    ["inapp"],
  [NotifyEvent.LEGAL_ASSIGNED]:             ["inapp", "email"],
};
