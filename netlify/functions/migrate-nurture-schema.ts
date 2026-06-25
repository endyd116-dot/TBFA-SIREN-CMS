/**
 * migrate-nurture-schema — 후원자 너처링 5테이블 생성 (1회용·멱등)
 *
 * Phase 1-1: nurture_journeys / nurture_steps / nurture_evergreen_rules /
 *            nurture_enrollments / nurture_sends + 세그먼트 4개 여정 시드(전부 OFF).
 *
 * 인증: 어드민 세션 OR ?secret=<INTERNAL_TRIGGER_SECRET> (메인이 직접 호출 가능하게).
 *   GET            : 진단 — 테이블 존재 여부.
 *   GET ?run=1     : 생성 실행(IF NOT EXISTS·ON CONFLICT — 여러 번 호출해도 안전).
 *
 * 호출·확인 후 즉시 삭제(1회용).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-nurture-schema" };
const H = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") || "";
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  let authed = expected !== "" && secret === expected;
  if (!authed) {
    const a = await requireAdmin(req);
    if (!a.ok) return (a as any).res;
    authed = true;
  }

  const run = url.searchParams.get("run") === "1";
  const TABLES = ["nurture_journeys", "nurture_steps", "nurture_evergreen_rules", "nurture_enrollments", "nurture_sends"];

  try {
    if (!run) {
      const r: any = await db.execute(sql`
        SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY(${sql.raw(`ARRAY['${TABLES.join("','")}']`)})
      `);
      const existing = (r?.rows ?? r ?? []).map((x: any) => x.table_name);
      return new Response(JSON.stringify({
        ok: true, mode: "진단", existing, missing: TABLES.filter((t) => !existing.includes(t)),
        note: "?run=1 로 생성",
      }, null, 2), { status: 200, headers: H });
    }

    /* ── 생성 (멱등) ── */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nurture_journeys (
        id           SERIAL PRIMARY KEY,
        segment      VARCHAR(40) NOT NULL UNIQUE,
        name         VARCHAR(150) NOT NULL,
        is_active    BOOLEAN NOT NULL DEFAULT false,
        entry_basis  VARCHAR(30) NOT NULL DEFAULT 'classified',
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nurture_steps (
        id           SERIAL PRIMARY KEY,
        journey_id   INTEGER NOT NULL REFERENCES nurture_journeys(id) ON DELETE CASCADE,
        day_offset   INTEGER NOT NULL,
        channel      VARCHAR(20) NOT NULL,
        template_id  INTEGER,
        conditions   JSONB DEFAULT '{}'::jsonb,
        label        VARCHAR(120),
        sort_order   INTEGER NOT NULL DEFAULT 0,
        is_active    BOOLEAN NOT NULL DEFAULT true,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS nurture_steps_journey_idx ON nurture_steps(journey_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nurture_evergreen_rules (
        id           SERIAL PRIMARY KEY,
        journey_id   INTEGER NOT NULL REFERENCES nurture_journeys(id) ON DELETE CASCADE,
        cadence      VARCHAR(20) NOT NULL,
        channel      VARCHAR(20) NOT NULL,
        template_id  INTEGER,
        conditions   JSONB DEFAULT '{}'::jsonb,
        label        VARCHAR(120),
        is_active    BOOLEAN NOT NULL DEFAULT true,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS nurture_evergreen_journey_idx ON nurture_evergreen_rules(journey_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nurture_enrollments (
        id                SERIAL PRIMARY KEY,
        member_id         INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        journey_id        INTEGER NOT NULL REFERENCES nurture_journeys(id) ON DELETE CASCADE,
        enrolled_at       TIMESTAMP NOT NULL,
        status            VARCHAR(20) NOT NULL DEFAULT 'active',
        converted_at      TIMESTAMP,
        last_evergreen_at TIMESTAMP,
        created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS nurture_enroll_member_journey_uq ON nurture_enrollments(member_id, journey_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS nurture_enroll_status_idx ON nurture_enrollments(status)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nurture_sends (
        id                SERIAL PRIMARY KEY,
        enrollment_id     INTEGER NOT NULL REFERENCES nurture_enrollments(id) ON DELETE CASCADE,
        step_id           INTEGER REFERENCES nurture_steps(id) ON DELETE SET NULL,
        evergreen_rule_id INTEGER REFERENCES nurture_evergreen_rules(id) ON DELETE SET NULL,
        channel           VARCHAR(20) NOT NULL,
        job_id            INTEGER,
        status            VARCHAR(20) NOT NULL DEFAULT 'queued',
        sent_at           TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS nurture_sends_enroll_idx ON nurture_sends(enrollment_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS nurture_sends_enroll_step_uq ON nurture_sends(enrollment_id, step_id)`);

    /* ── 세그먼트 4개 여정 시드 (전부 OFF — 운영자가 검토 후 켬) ── */
    await db.execute(sql`
      INSERT INTO nurture_journeys (segment, name, is_active) VALUES
        ('regular',            '정기 후원자 — 유지·상향',  false),
        ('prospect_onetime',   '예비(일시) — 정기 전환',   false),
        ('prospect_cancelled', '예비(이탈) — 재활성화',    false),
        ('potential',          '잠재 후원자 — 첫 후원',    false)
      ON CONFLICT (segment) DO NOTHING
    `);

    const chk: any = await db.execute(sql`SELECT segment, name, is_active FROM nurture_journeys ORDER BY id`);
    return new Response(JSON.stringify({
      ok: true, mode: "생성완료", tables: TABLES, journeys: (chk?.rows ?? chk ?? []),
    }, null, 2), { status: 200, headers: H });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "스키마 생성 실패", detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 800),
    }), { status: 500, headers: H });
  }
}
