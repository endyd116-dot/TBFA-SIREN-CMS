// netlify/functions/migrate-phase9-notify-prefs.ts
// Phase 9-B 마이그레이션: 알림 수신 설정 테이블 + 전화인증/카카오 동의 컬럼
//
// 실행: 어드민 로그인 후 주소창에
//   https://tbfa-siren-cms.netlify.app/api/migrate-phase9-notify-prefs?run=1
// 진단: ?run=1 없이 접속 (인증 불필요)
// 멱등: IF NOT EXISTS + 중복 INSERT 방지

import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-phase9-notify-prefs" };

const SEED_DEFAULTS = [
  { event_type: "billing.success",             default_channels: ["inapp", "email"],           forced_channels: [] },
  { event_type: "billing.failed",              default_channels: ["inapp", "email", "kakao"],  forced_channels: ["inapp", "email"] },
  { event_type: "billing.canceled",            default_channels: ["inapp", "email"],           forced_channels: [] },
  { event_type: "card.expiring",               default_channels: ["inapp", "email", "kakao"],  forced_channels: ["inapp", "email"] },
  { event_type: "workspace.activity",          default_channels: ["inapp"],                    forced_channels: [] },
  { event_type: "admin.daily_briefing",        default_channels: ["email"],                    forced_channels: [] },
  { event_type: "support.reply",               default_channels: ["inapp", "email"],           forced_channels: [] },
  { event_type: "siren.assigned",              default_channels: ["inapp", "email"],           forced_channels: [] },
  { event_type: "member.eligibility_decided",  default_channels: ["inapp", "email"],           forced_channels: [] },
];

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* ── 진단 모드 (run=1 없음) ── */
  if (!run) {
    try {
      const res: any = await db.execute(sql`
        SELECT
          EXISTS(SELECT 1 FROM information_schema.tables
                 WHERE table_name = 'notification_preferences')::boolean AS has_prefs,
          EXISTS(SELECT 1 FROM information_schema.tables
                 WHERE table_name = 'notification_admin_settings')::boolean AS has_admin,
          EXISTS(SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'members'
                   AND column_name = 'phone_verified_at')::boolean AS has_phone_col,
          EXISTS(SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'members'
                   AND column_name = 'kakao_marketing_consent_at')::boolean AS has_kakao_col
      `);
      const row = (res?.rows ?? res)[0] ?? {};
      return new Response(JSON.stringify({ ok: true, mode: "diagnostic", state: row }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  }

  /* ── 실행 모드 (run=1) — 어드민 인증 필요 ── */
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const steps: string[] = [];
  try {
    /* 1. notification_preferences 테이블 */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id             bigserial PRIMARY KEY,
        member_id      integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        event_type     text    NOT NULL,
        channels       jsonb   NOT NULL DEFAULT '[]'::jsonb,
        created_at     timestamptz NOT NULL DEFAULT now(),
        updated_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT notification_prefs_unique UNIQUE (member_id, event_type)
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS notification_prefs_member_idx
        ON notification_preferences (member_id)
    `);
    steps.push("notification_preferences 테이블 생성");

    /* 2. notification_admin_settings 테이블 */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notification_admin_settings (
        event_type       text PRIMARY KEY,
        default_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
        forced_channels  jsonb NOT NULL DEFAULT '[]'::jsonb,
        updated_at       timestamptz NOT NULL DEFAULT now(),
        updated_by       integer REFERENCES members(id) ON DELETE SET NULL
      )
    `);
    steps.push("notification_admin_settings 테이블 생성");

    /* 3. 기본값 시드 (충돌 시 스킵) */
    for (const row of SEED_DEFAULTS) {
      await db.execute(sql`
        INSERT INTO notification_admin_settings (event_type, default_channels, forced_channels)
        VALUES (
          ${row.event_type},
          ${JSON.stringify(row.default_channels)}::jsonb,
          ${JSON.stringify(row.forced_channels)}::jsonb
        )
        ON CONFLICT (event_type) DO NOTHING
      `);
    }
    steps.push(`기본 정책 ${SEED_DEFAULTS.length}건 시드`);

    /* 4. members.phone_verified_at 컬럼 */
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz
    `);
    steps.push("members.phone_verified_at 컬럼 추가");

    /* 5. members.kakao_marketing_consent_at 컬럼 */
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS kakao_marketing_consent_at timestamptz
    `);
    steps.push("members.kakao_marketing_consent_at 컬럼 추가");

    return new Response(
      JSON.stringify({ ok: true, steps }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "마이그레이션 실패", steps,
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
