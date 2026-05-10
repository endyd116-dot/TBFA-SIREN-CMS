// netlify/functions/admin-notification-defaults.ts
// Phase 9-B — 어드민 전역 알림 기본 정책 조회·수정
//
// GET   /api/admin-notification-defaults          → 전체 이벤트 기본 정책 조회
// PATCH /api/admin-notification-defaults          → 이벤트 1건 기본 채널 수정
// GET   /api/admin-notification-defaults?history=1 → 변경 이력 (감사 로그)

import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { NotifyEvent, EVENT_CHANNEL_POLICY, FORCED_CHANNELS, ChannelName } from "../../lib/notify-events";

export const config = { path: "/api/admin-notification-defaults" };

const VALID_EVENTS = Object.values(NotifyEvent) as string[];
const VALID_CHANNELS: ChannelName[] = ["inapp", "email", "sms", "kakao"];

const EVENT_LABELS: Record<string, string> = {
  "billing.success":            "결제 성공",
  "billing.failed":             "결제 실패",
  "billing.canceled":           "결제 취소",
  "card.expiring":              "카드 만료 예정",
  "workspace.activity":         "워크스페이스 활동",
  "admin.daily_briefing":       "어드민 일일 브리핑",
  "support.reply":              "지원 회신",
  "siren.assigned":             "SIREN 할당",
  "member.eligibility_decided": "회원 자격 결정",
};

function jsonOk(data: any) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "어드민 기본 정책 처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const adminId: number = auth.ctx.admin.uid;
  const url = new URL(req.url);

  /* ── GET: 전체 기본 정책 조회 ── */
  if (req.method === "GET") {
    const showHistory = url.searchParams.get("history") === "1";

    if (showHistory) {
      /* 변경 이력: 감사 로그에서 조회 */
      try {
        const histRes: any = await db.execute(sql`
          SELECT al.id, al.action, al.target_table, al.target_id, al.changes,
                 al.created_at, m.name AS admin_name
          FROM audit_logs al
          LEFT JOIN members m ON m.id = al.actor_id
          WHERE al.target_table = 'notification_admin_settings'
          ORDER BY al.created_at DESC
          LIMIT 50
        `);
        const history = histRes?.rows ?? histRes;
        return jsonOk({ history });
      } catch (err: any) {
        return jsonError("history", err);
      }
    }

    /* 기본 정책 조회 */
    try {
      const settingsRes: any = await db.execute(sql`
        SELECT event_type, default_channels, forced_channels, updated_at, updated_by
        FROM notification_admin_settings
        ORDER BY event_type
      `);
      const rows = settingsRes?.rows ?? settingsRes;
      const settingsMap: Record<string, any> = {};
      for (const r of rows) {
        settingsMap[r.event_type] = {
          defaultChannels: Array.isArray(r.default_channels) ? r.default_channels : [],
          forcedChannels:  Array.isArray(r.forced_channels)  ? r.forced_channels  : [],
          updatedAt:       r.updated_at,
          updatedBy:       r.updated_by,
        };
      }

      /* 이벤트별 통합 (DB에 없는 항목은 코드 기본값) */
      const events = VALID_EVENTS.map(eventType => {
        const db_row = settingsMap[eventType];
        return {
          eventType,
          label:           EVENT_LABELS[eventType] ?? eventType,
          defaultChannels: db_row?.defaultChannels ?? (EVENT_CHANNEL_POLICY[eventType as NotifyEvent] ?? []),
          forcedChannels:  db_row?.forcedChannels  ?? (FORCED_CHANNELS[eventType as NotifyEvent] ?? []),
          updatedAt:       db_row?.updatedAt ?? null,
          updatedBy:       db_row?.updatedBy ?? null,
        };
      });

      /* 이벤트별 사용자 커스텀 설정 수 (통계) */
      let customCounts: Record<string, number> = {};
      try {
        const cntRes: any = await db.execute(sql`
          SELECT event_type, COUNT(*)::int AS cnt
          FROM notification_preferences
          GROUP BY event_type
        `);
        for (const r of (cntRes?.rows ?? cntRes)) {
          customCounts[r.event_type] = r.cnt;
        }
      } catch (_) { /* 마이그레이션 전 무시 */ }

      return jsonOk({ events, customCounts });
    } catch (err: any) {
      return jsonError("select", err);
    }
  }

  /* ── PATCH: 이벤트 1건 기본 채널 수정 ── */
  if (req.method === "PATCH") {
    let body: any;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ ok: false, error: "JSON 파싱 오류" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const { event_type, default_channels } = body ?? {};
    if (!event_type || !VALID_EVENTS.includes(event_type))
      return new Response(JSON.stringify({ ok: false, error: "유효하지 않은 event_type" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    if (!Array.isArray(default_channels))
      return new Response(JSON.stringify({ ok: false, error: "default_channels는 배열이어야 합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });

    const filtered = default_channels.filter((c: any) => VALID_CHANNELS.includes(c)) as ChannelName[];
    // 강제 채널은 항상 포함
    const forced: ChannelName[] = FORCED_CHANNELS[event_type as NotifyEvent] ?? [];
    const merged = [...new Set([...forced, ...filtered])] as ChannelName[];

    try {
      /* 변경 전 값 조회 (감사 로그용) */
      const beforeRes: any = await db.execute(sql`
        SELECT default_channels FROM notification_admin_settings
        WHERE event_type = ${event_type} LIMIT 1
      `);
      const before = (beforeRes?.rows ?? beforeRes)?.[0]?.default_channels ?? null;

      await db.execute(sql`
        INSERT INTO notification_admin_settings (event_type, default_channels, forced_channels, updated_at, updated_by)
        VALUES (
          ${event_type},
          ${JSON.stringify(merged)}::jsonb,
          ${JSON.stringify(forced)}::jsonb,
          now(),
          ${adminId}
        )
        ON CONFLICT (event_type) DO UPDATE
          SET default_channels = EXCLUDED.default_channels,
              updated_at = EXCLUDED.updated_at,
              updated_by = EXCLUDED.updated_by
      `);

      /* 감사 로그 기록 */
      try {
        await db.execute(sql`
          INSERT INTO audit_logs (actor_type, actor_id, action, target_table, target_id, changes, created_at)
          VALUES (
            'admin', ${adminId}, 'update', 'notification_admin_settings',
            ${event_type},
            ${JSON.stringify({ before, after: merged })}::jsonb,
            now()
          )
        `);
      } catch (_) { /* 감사 로그 실패는 무시 */ }

      return jsonOk({ event_type, default_channels: merged });
    } catch (err: any) {
      return jsonError("upsert", err);
    }
  }

  return new Response(JSON.stringify({ ok: false, error: "GET/PATCH only" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
