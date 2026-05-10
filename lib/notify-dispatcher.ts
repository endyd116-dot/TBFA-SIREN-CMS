// lib/notify-dispatcher.ts
// Phase 8 — 알림 채널 통합 디스패처
// Phase 9-B — 사용자 수신 설정 조회 통합
//
// 사용법 (발신 지점에서):
//   import { dispatch } from "../../lib/notify-dispatcher";
//   import { NotifyEvent } from "../../lib/notify-events";
//
//   dispatch({
//     event: NotifyEvent.BILLING_SUCCESS,
//     target: { type: "member", id: memberId },
//     params: { memberName, amount, ... },
//   });
//   // fire-and-forget — await 불필요, 내부 오류가 발신 지점을 죽이지 않음
//
// 채널 결정 우선순위 (Phase 9-B):
//   1. 사용자 설정(notification_preferences) 있으면 사용
//   2. 없으면 어드민 기본값(notification_admin_settings)
//   3. DB 접근 실패(마이그레이션 미실행 등) → EVENT_CHANNEL_POLICY 폴백
//   4. 강제 채널(FORCED_CHANNELS)은 사용자 설정과 관계없이 항상 포함
//   5. 전화번호 미인증 → sms/kakao 발송 제외
//
// 재시도 정책 (외부 채널):
//   초기 실패 → +1s → 1차 재시도 실패 → +5s → 2차 → +25s → 3차 → dead
//   인앱 채널: 1회 실패 → 즉시 dead (DB INSERT는 거의 실패하지 않음)

import { db } from "../db";
import { notificationDispatchLogs } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { NotifyEvent, EVENT_CHANNEL_POLICY, FORCED_CHANNELS, ChannelName } from "./notify-events";
import type { NotifyAdapter } from "./notify-adapters/types";
import { inappAdapter }           from "./notify-adapters/inapp";
import { emailAdapter }           from "./notify-adapters/email";
import { smsPlaceholderAdapter }  from "./notify-adapters/sms-placeholder";
import { kakaoPlaceholderAdapter } from "./notify-adapters/kakao-placeholder";

/* =========================================================
   재시도 백오프 딜레이 (ms)
   ========================================================= */
const RETRY_DELAYS_MS = [1_000, 5_000, 25_000] as const;

/* =========================================================
   채널 → 어댑터 라우팅 테이블
   ========================================================= */
const ADAPTERS: Record<ChannelName, NotifyAdapter> = {
  inapp: inappAdapter,
  email: emailAdapter,
  sms:   smsPlaceholderAdapter,
  kakao: kakaoPlaceholderAdapter,
};

/* =========================================================
   공개 타입
   ========================================================= */
export interface DispatchOptions {
  event:  NotifyEvent;
  target: { type: "member" | "admin"; id: number };
  /** 템플릿 파라미터 + 인앱 알림 본문 (title·message·link·category·severity 등) */
  params: Record<string, any>;
}

/* =========================================================
   dispatch — 진입점 (fire-and-forget)
   ========================================================= */
export function dispatch(opts: DispatchOptions): void {
  _dispatch(opts).catch(err =>
    console.error("[notify-dispatcher] uncaught dispatch error:", err),
  );
}

/* =========================================================
   내부: 채널 결정 (Phase 9-B)
   - 마이그레이션 전: 테이블 접근 실패 → EVENT_CHANNEL_POLICY 폴백
   - 어드민 대상: 사용자 설정 없이 EVENT_CHANNEL_POLICY 사용
   ========================================================= */
async function _resolveChannels(
  targetType: "member" | "admin",
  targetId: number,
  event: NotifyEvent,
): Promise<ChannelName[]> {
  const forced: ChannelName[] = FORCED_CHANNELS[event] ?? [];
  const policyDefault: ChannelName[] = EVENT_CHANNEL_POLICY[event] ?? [];

  // 어드민 대상은 사용자 설정 없음
  if (targetType !== "member") {
    return [...new Set([...forced, ...policyDefault])] as ChannelName[];
  }

  try {
    /* 1. 사용자 설정 조회 */
    const prefRes: any = await db.execute(sql`
      SELECT channels FROM notification_preferences
      WHERE member_id = ${targetId} AND event_type = ${event}
      LIMIT 1
    `);
    const prefRow = (prefRes?.rows ?? prefRes)?.[0];

    /* 2. 어드민 기본값 조회 (사용자 설정 없을 때) */
    let selectedChannels: ChannelName[];
    if (prefRow) {
      selectedChannels = Array.isArray(prefRow.channels) ? prefRow.channels : [];
    } else {
      const adminRes: any = await db.execute(sql`
        SELECT default_channels FROM notification_admin_settings
        WHERE event_type = ${event}
        LIMIT 1
      `);
      const adminRow = (adminRes?.rows ?? adminRes)?.[0];
      selectedChannels = adminRow && Array.isArray(adminRow.default_channels)
        ? adminRow.default_channels
        : policyDefault;
    }

    /* 3. 강제 채널 합집합 */
    const merged = [...new Set([...forced, ...selectedChannels])] as ChannelName[];

    /* 4. 전화번호 인증 여부 확인 (sms/kakao 필터) */
    const memberRes: any = await db.execute(sql`
      SELECT phone_verified_at, kakao_marketing_consent_at
      FROM members WHERE id = ${targetId} LIMIT 1
    `);
    const member = (memberRes?.rows ?? memberRes)?.[0] ?? {};
    const phoneVerified  = !!member.phone_verified_at;
    const kakaoConsented = !!member.kakao_marketing_consent_at;

    return merged.filter(ch => {
      if (ch === "sms"   && !phoneVerified)  return false;
      if (ch === "kakao" && !kakaoConsented) return false;
      return true;
    });
  } catch (err) {
    // 마이그레이션 미실행 등 — EVENT_CHANNEL_POLICY 폴백
    console.warn("[notify-dispatcher] preferences 조회 실패 (마이그레이션 미실행?):", String(err));
    return [...new Set([...forced, ...policyDefault])] as ChannelName[];
  }
}

/* =========================================================
   내부: 실제 발송 로직
   ========================================================= */
async function _dispatch(opts: DispatchOptions): Promise<void> {
  const channels = await _resolveChannels(opts.target.type, opts.target.id, opts.event);

  for (const channel of channels) {
    /* --- 1. dispatch_logs INSERT (status='pending', attempt=0) --- */
    let logId: number;
    try {
      const [logRow] = await db
        .insert(notificationDispatchLogs)
        .values({
          eventType:      opts.event,
          targetType:     opts.target.type,
          targetId:       opts.target.id,
          channel,
          status:         "pending",
          attempt:        0,
          paramsSnapshot: opts.params as any,
        } as any)
        .returning({ id: notificationDispatchLogs.id });
      logId = logRow.id;
    } catch (err) {
      console.error(`[notify-dispatcher] log INSERT 실패 channel=${channel}:`, err);
      continue;
    }

    /* --- 2. 어댑터 호출 --- */
    const adapter = ADAPTERS[channel];
    if (!adapter) {
      await _updateLog(logId, { status: "dead", error: `어댑터 없음: ${channel}` });
      continue;
    }

    const result = await adapter.send({
      logId,
      targetType: opts.target.type,
      targetId:   opts.target.id,
      event:      opts.event,
      params:     opts.params,
    });

    /* --- 3. 결과 반영 --- */
    if (result.ok) {
      const extra: Record<string, any> = {};
      if (channel === "inapp" && result.providerMessageId) {
        const nid = parseInt(result.providerMessageId);
        if (!isNaN(nid)) extra.notificationId = nid;
      }
      await _updateLog(logId, {
        status: "sent",
        providerMessageId: result.providerMessageId,
        latencyMs: result.latencyMs,
        sentAt: new Date(),
        ...extra,
      });
    } else {
      if (channel === "inapp") {
        await _updateLog(logId, {
          status: "dead",
          error: result.error?.slice(0, 500),
          latencyMs: result.latencyMs,
        });
        console.error(`[notify-dispatcher] inapp dead logId=${logId}:`, result.error);
      } else {
        const nextRetryAt = new Date(Date.now() + RETRY_DELAYS_MS[0]);
        await _updateLog(logId, {
          error: result.error?.slice(0, 500),
          latencyMs: result.latencyMs,
          nextRetryAt,
        });
        console.warn(
          `[notify-dispatcher] ${channel} 실패 → 재시도 예약 logId=${logId}` +
          ` nextRetryAt=${nextRetryAt.toISOString()}`,
        );
      }
    }
  }
}

/* =========================================================
   retryLog — cron-notification-retry.ts 전용
   특정 로그 1건을 재발송 시도하고 상태를 갱신한다.
   ========================================================= */
export async function retryLog(
  logId: number,
): Promise<{ ok: boolean; status: string; error?: string }> {
  try {
    const rows: any = await db.execute(
      sql`SELECT * FROM notification_dispatch_logs WHERE id = ${logId} LIMIT 1`,
    );
    const log = (Array.isArray(rows) ? rows[0] : (rows as any).rows?.[0]) as any;

    if (!log)            return { ok: false, status: "not_found",   error: "log not found" };
    if (log.status !== "pending")
                         return { ok: false, status: "not_pending",  error: `status=${log.status}` };

    const channel = log.channel as ChannelName;
    const adapter = ADAPTERS[channel];
    if (!adapter) {
      await _updateLog(logId, { status: "dead", error: `어댑터 없음: ${channel}` });
      return { ok: false, status: "dead", error: "no adapter" };
    }

    const result = await adapter.send({
      logId,
      targetType: log.target_type as "member" | "admin",
      targetId:   Number(log.target_id),
      event:      log.event_type as NotifyEvent,
      params:     (log.params_snapshot as Record<string, any>) || {},
    });

    if (result.ok) {
      await _updateLog(logId, {
        status: "sent",
        providerMessageId: result.providerMessageId,
        latencyMs: result.latencyMs,
        sentAt: new Date(),
      });
      return { ok: true, status: "sent" };
    }

    const newAttempt = (Number(log.attempt) || 0) + 1;
    if (newAttempt >= 3) {
      await _updateLog(logId, {
        status:    "dead",
        attempt:   newAttempt,
        error:     result.error?.slice(0, 500),
        latencyMs: result.latencyMs,
      });
      return { ok: false, status: "dead", error: result.error };
    }

    const nextRetryAt = new Date(Date.now() + RETRY_DELAYS_MS[newAttempt]);
    await _updateLog(logId, {
      attempt:    newAttempt,
      error:      result.error?.slice(0, 500),
      latencyMs:  result.latencyMs,
      nextRetryAt,
    });
    return { ok: false, status: "pending", error: result.error };
  } catch (err: any) {
    console.error("[notify-dispatcher] retryLog 오류:", err);
    return { ok: false, status: "error", error: String(err?.message || err) };
  }
}

/* =========================================================
   내부 헬퍼
   ========================================================= */
async function _updateLog(id: number, fields: Record<string, any>): Promise<void> {
  try {
    await db
      .update(notificationDispatchLogs)
      .set(fields as any)
      .where(eq(notificationDispatchLogs.id, id));
  } catch (err) {
    console.error(`[notify-dispatcher] log UPDATE 실패 id=${id}:`, err);
  }
}
