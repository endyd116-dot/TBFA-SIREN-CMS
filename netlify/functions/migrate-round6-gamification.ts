import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { pointRules, badgeDefinitions } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-round6-gamification" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run");

  if (run !== "1") {
    return new Response(
      JSON.stringify({
        ok: true,
        mode: "diagnostic",
        message: "?run=1 파라미터를 추가하면 마이그레이션이 실행됩니다",
        plan: [
          "point_rules 테이블 생성 + 기본 규칙 3개 시드",
          "member_point_logs 테이블 생성",
          "badge_definitions 테이블 생성 + 기본 뱃지 5개 시드",
          "member_badges 테이블 생성",
          "rewards 테이블 생성",
          "reward_redemptions 테이블 생성",
          "site_popups 테이블 생성",
          "site_curations 테이블 생성",
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const auth: any = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const results: string[] = [];

  try {
    // point_rules
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS point_rules (
        id           SERIAL PRIMARY KEY,
        event_type   VARCHAR(40) NOT NULL UNIQUE,
        point_amount INTEGER NOT NULL DEFAULT 0,
        is_active    BOOLEAN NOT NULL DEFAULT true,
        description  VARCHAR(200),
        created_at   TIMESTAMP DEFAULT NOW()
      )
    `);
    results.push("point_rules 테이블 생성: OK");

    await db.execute(sql`
      INSERT INTO point_rules (event_type, point_amount, description)
      VALUES
        ('donation_complete', 100, '후원 완료 1만원당 100포인트'),
        ('login_daily',       1,   '일일 첫 로그인 1포인트'),
        ('campaign_join',     10,  '캠페인 참여 10포인트')
      ON CONFLICT (event_type) DO NOTHING
    `);
    results.push("point_rules 기본 시드: OK");

    // member_point_logs
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS member_point_logs (
        id           SERIAL PRIMARY KEY,
        member_id    INTEGER NOT NULL,
        delta        INTEGER NOT NULL,
        reason       VARCHAR(200),
        event_type   VARCHAR(40),
        reference_id INTEGER,
        created_at   TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS member_point_logs_member_idx ON member_point_logs(member_id)
    `);
    results.push("member_point_logs 테이블 생성: OK");

    // badge_definitions
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS badge_definitions (
        code            VARCHAR(50) PRIMARY KEY,
        name_ko         VARCHAR(50) NOT NULL,
        icon            VARCHAR(100),
        condition_type  VARCHAR(30) NOT NULL,
        condition_value INTEGER NOT NULL,
        description     VARCHAR(200),
        is_active       BOOLEAN NOT NULL DEFAULT true,
        sort_order      INTEGER DEFAULT 0
      )
    `);
    results.push("badge_definitions 테이블 생성: OK");

    await db.execute(sql`
      INSERT INTO badge_definitions (code, name_ko, icon, condition_type, condition_value, description, sort_order)
      VALUES
        ('first_step',  '첫 걸음',     '🌱', 'donation_count',  1,    '첫 번째 후원 완료',    1),
        ('supporter',   '서포터',      '💙', 'donation_count',  3,    '3회 후원 완료',       2),
        ('champion',    '챔피언',      '🏆', 'donation_count',  10,   '10회 후원 완료',      3),
        ('point_100',   '100포인트',   '⭐', 'point_threshold', 100,  '포인트 100 달성',     4),
        ('point_1000',  '1000포인트',  '🌟', 'point_threshold', 1000, '포인트 1000 달성',    5)
      ON CONFLICT (code) DO NOTHING
    `);
    results.push("badge_definitions 기본 시드: OK");

    // member_badges
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS member_badges (
        id         SERIAL PRIMARY KEY,
        member_id  INTEGER NOT NULL,
        badge_code VARCHAR(50) NOT NULL,
        awarded_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(member_id, badge_code)
      )
    `);
    results.push("member_badges 테이블 생성: OK");

    // rewards
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS rewards (
        id          SERIAL PRIMARY KEY,
        name_ko     VARCHAR(100) NOT NULL,
        description TEXT,
        point_cost  INTEGER NOT NULL,
        stock       INTEGER,
        is_active   BOOLEAN NOT NULL DEFAULT true,
        image_url   VARCHAR(500),
        created_at  TIMESTAMP DEFAULT NOW()
      )
    `);
    results.push("rewards 테이블 생성: OK");

    // reward_redemptions
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS reward_redemptions (
        id           SERIAL PRIMARY KEY,
        member_id    INTEGER NOT NULL,
        reward_id    INTEGER NOT NULL,
        point_cost   INTEGER NOT NULL,
        status       VARCHAR(20) NOT NULL DEFAULT 'pending',
        note         VARCHAR(300),
        redeemed_at  TIMESTAMP DEFAULT NOW(),
        processed_at TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS reward_redemptions_member_idx ON reward_redemptions(member_id)
    `);
    results.push("reward_redemptions 테이블 생성: OK");

    // site_popups
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS site_popups (
        id                SERIAL PRIMARY KEY,
        title             VARCHAR(100) NOT NULL,
        content           TEXT,
        image_url         VARCHAR(500),
        link_url          VARCHAR(500),
        target_pages      JSONB DEFAULT '["*"]'::jsonb,
        display_frequency VARCHAR(20) NOT NULL DEFAULT 'once_day',
        start_at          TIMESTAMP,
        end_at            TIMESTAMP,
        is_active         BOOLEAN NOT NULL DEFAULT true,
        created_at        TIMESTAMP DEFAULT NOW()
      )
    `);
    results.push("site_popups 테이블 생성: OK");

    // site_curations
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS site_curations (
        id         SERIAL PRIMARY KEY,
        slot       VARCHAR(40) NOT NULL,
        title      VARCHAR(100),
        items      JSONB DEFAULT '[]'::jsonb,
        is_active  BOOLEAN NOT NULL DEFAULT true,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    results.push("site_curations 테이블 생성: OK");

  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "마이그레이션 실패",
        step: "create_tables",
        detail: String(err?.message || err).slice(0, 500),
        results,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ ok: true, results }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
