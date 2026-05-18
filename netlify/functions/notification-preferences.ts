// netlify/functions/notification-preferences.ts
// Phase 9-B — 사용자 알림 수신 설정 조회·저장
//
// GET  /api/notification-preferences        → 본인 전체 이벤트 설정 조회
// PATCH /api/notification-preferences       → 이벤트 1건 채널 저장 (event_type + channels)

import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireActiveUser } from "../../lib/auth";
import { sql } from "drizzle-orm";
import { NotifyEvent, EVENT_CHANNEL_POLICY, FORCED_CHANNELS, ChannelName } from "../../lib/notify-events";

export const config = { path: "/api/notification-preferences" };

const VALID_EVENTS = Object.values(NotifyEvent) as string[];
const VALID_CHANNELS: ChannelName[] = ["inapp", "email", "sms", "kakao"];

function jsonOk(data: any, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "알림 설정 처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}
function jsonBad(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireActiveUser(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const memberId: number = auth.user.uid;

  /* ── GET: 전체 설정 + 어드민 기본값 + 강제 채널 반환 ── */
  if (req.method === "GET") {
    try {
      /* 사용자 설정 */
      const prefsRes: any = await db.execute(sql`
        SELECT event_type, channels, updated_at
        FROM notification_preferences
        WHERE member_id = ${memberId}
      `);
      const rows = prefsRes?.rows ?? prefsRes;
      const prefMap: Record<string, ChannelName[]> = {};
      for (const r of rows) {
        prefMap[r.event_type] = Array.isArray(r.channels) ? r.channels : [];
      }

      /* 어드민 기본값 */
      const adminRes: any = await db.execute(sql`
        SELECT event_type, default_channels, forced_channels
        FROM notification_admin_settings
      `);
      const adminRows = adminRes?.rows ?? adminRes;
      const adminMap: Record<string, { defaultChannels: ChannelName[]; forcedChannels: ChannelName[] }> = {};
      for (const r of adminRows) {
        adminMap[r.event_type] = {
          defaultChannels: Array.isArray(r.default_channels) ? r.default_channels : [],
          forcedChannels:  Array.isArray(r.forced_channels)  ? r.forced_channels  : [],
        };
      }

      /* 전화번호 인증 여부 */
      let phoneVerified = false;
      try {
        const mRes: any = await db.execute(sql`
          SELECT phone_verified_at FROM members WHERE id = ${memberId} LIMIT 1
        `);
        phoneVerified = !!(mRes?.rows ?? mRes)?.[0]?.phone_verified_at;
      } catch (_) { /* phone_verified_at 컬럼 없으면 false */ }

      /* 이벤트별 통합 설정 객체 반환 */
      const events = VALID_EVENTS.map(eventType => {
        const admin = adminMap[eventType] ?? {
          defaultChannels: EVENT_CHANNEL_POLICY[eventType as NotifyEvent] ?? [],
          forcedChannels: FORCED_CHANNELS[eventType as NotifyEvent] ?? [],
        };
        const userChannels = prefMap[eventType] ?? admin.defaultChannels;
        return {
          eventType,
          channels:       userChannels,
          defaultChannels: admin.defaultChannels,
          forcedChannels:  admin.forcedChannels,
          hasCustom:       !!prefMap[eventType],
        };
      });

      /* 라운드 10: 평탄 키 별칭(preferences) 추가 — 신규 프론트 호환 */
      const preferences = events.map(e => ({ eventType: e.eventType, channels: e.channels }));
      return new Response(JSON.stringify({
        ok: true,
        preferences,
        data: { events, phoneVerified },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("select", err);
    }
  }

  /* ── PUT: 라운드 10 — 여러 이벤트 일괄 upsert ── */
  if (req.method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch { return jsonBad("JSON 파싱 오류"); }
    const list = Array.isArray(body?.preferences) ? body.preferences : null;
    if (!list) return jsonBad("preferences 배열이 필요합니다");

    try {
      for (const p of list) {
        const eventType = String(p?.eventType || "");
        if (!eventType || !VALID_EVENTS.includes(eventType)) continue;
        const rawChannels = Array.isArray(p?.channels) ? p.channels : [];
        const filtered = rawChannels.filter((c: any) => VALID_CHANNELS.includes(c)) as ChannelName[];
        const forced: ChannelName[] = FORCED_CHANNELS[eventType as NotifyEvent] ?? [];
        const merged = [...new Set([...forced, ...filtered])] as ChannelName[];

        await db.execute(sql`
          INSERT INTO notification_preferences (member_id, event_type, channels, updated_at)
          VALUES (${memberId}, ${eventType}, ${JSON.stringify(merged)}::jsonb, now())
          ON CONFLICT (member_id, event_type)
          DO UPDATE SET channels = EXCLUDED.channels, updated_at = now()
        `);
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("put_upsert", err);
    }
  }

  /* ── PATCH: 이벤트 1건 채널 저장 ── */
  if (req.method === "PATCH") {
    let body: any;
    try { body = await req.json(); } catch { return jsonBad("JSON 파싱 오류"); }

    const { event_type, channels } = body ?? {};
    if (!event_type || !VALID_EVENTS.includes(event_type))
      return jsonBad("유효하지 않은 event_type");
    if (!Array.isArray(channels))
      return jsonBad("channels는 배열이어야 합니다");

    // 유효 채널 필터
    const filtered = channels.filter((c: any) => VALID_CHANNELS.includes(c)) as ChannelName[];

    // 강제 채널 보장 (클라이언트에서 제거해도 서버에서 복원)
    const forced: ChannelName[] = FORCED_CHANNELS[event_type as NotifyEvent] ?? [];
    const merged = [...new Set([...forced, ...filtered])] as ChannelName[];

    try {
      await db.execute(sql`
        INSERT INTO notification_preferences (member_id, event_type, channels, updated_at)
        VALUES (${memberId}, ${event_type}, ${JSON.stringify(merged)}::jsonb, now())
        ON CONFLICT (member_id, event_type)
        DO UPDATE SET channels = EXCLUDED.channels, updated_at = now()
      `);
      return jsonOk({ event_type, channels: merged });
    } catch (err: any) {
      return jsonError("upsert", err);
    }
  }

  /* ── DELETE: 이벤트 1건 설정 초기화 (기본값으로 복귀) ── */
  if (req.method === "DELETE") {
    let body: any;
    try { body = await req.json(); } catch { return jsonBad("JSON 파싱 오류"); }
    const { event_type } = body ?? {};
    if (!event_type || !VALID_EVENTS.includes(event_type))
      return jsonBad("유효하지 않은 event_type");

    try {
      await db.execute(sql`
        DELETE FROM notification_preferences
        WHERE member_id = ${memberId} AND event_type = ${event_type}
      `);
      return jsonOk({ event_type, reset: true });
    } catch (err: any) {
      return jsonError("delete", err);
    }
  }

  return new Response(JSON.stringify({ ok: false, error: "GET/PUT/PATCH/DELETE only" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
