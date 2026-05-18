import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-phase26-attendance" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run");

  if (run !== "1") {
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnose",
      message: "Phase 26 근태관리 마이그레이션 준비됨. ?run=1로 실행.",
      tables: [
        "att_holidays", "att_workplaces", "att_policies",
        "att_leave_types", "att_leave_balances", "att_leave_requests",
        "att_schedules", "att_schedule_overrides", "att_records", "att_corrections",
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const steps: string[] = [];

  try {
    // 1. att_holidays
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS att_holidays (
        id         SERIAL PRIMARY KEY,
        date       DATE NOT NULL UNIQUE,
        name       VARCHAR(100) NOT NULL,
        type       VARCHAR(20) NOT NULL DEFAULT 'PUBLIC',
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_holidays_date_idx ON att_holidays(date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_holidays_type_idx ON att_holidays(type)`);
    steps.push("att_holidays 생성");

    // 2. att_workplaces
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS att_workplaces (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        type       VARCHAR(20) NOT NULL,
        address    TEXT,
        lat        NUMERIC(10,7),
        lng        NUMERIC(10,7),
        radius     INTEGER NOT NULL DEFAULT 50,
        is_active  BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_workplaces_type_idx ON att_workplaces(type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_workplaces_active_idx ON att_workplaces(is_active)`);
    steps.push("att_workplaces 생성");

    // 3. att_policies
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS att_policies (
        id                      SERIAL PRIMARY KEY,
        name                    VARCHAR(100) NOT NULL,
        check_in_time           TIME NOT NULL DEFAULT '09:00',
        check_out_time          TIME NOT NULL DEFAULT '18:00',
        late_grace_mins         INTEGER NOT NULL DEFAULT 10,
        early_leave_grace_mins  INTEGER NOT NULL DEFAULT 10,
        daily_hours             NUMERIC(4,2) NOT NULL DEFAULT 8,
        break_mins              INTEGER NOT NULL DEFAULT 60,
        break_threshold_hours   NUMERIC(4,2) NOT NULL DEFAULT 4,
        weekly_max_hours        INTEGER NOT NULL DEFAULT 52,
        core_start_time         TIME DEFAULT '10:00',
        core_end_time           TIME DEFAULT '16:00',
        flex_enabled            BOOLEAN NOT NULL DEFAULT false,
        remote_max_per_month    INTEGER NOT NULL DEFAULT 10,
        is_default              BOOLEAN NOT NULL DEFAULT false,
        created_at              TIMESTAMP NOT NULL DEFAULT now(),
        updated_at              TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_policies_default_idx ON att_policies(is_default)`);
    steps.push("att_policies 생성");

    // 4. att_leave_types
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS att_leave_types (
        id                SERIAL PRIMARY KEY,
        name              VARCHAR(100) NOT NULL,
        is_paid           BOOLEAN NOT NULL DEFAULT true,
        unit              VARCHAR(10) NOT NULL DEFAULT 'day',
        requires_approval BOOLEAN NOT NULL DEFAULT true,
        default_days      NUMERIC(5,2) NOT NULL DEFAULT 0,
        is_active         BOOLEAN NOT NULL DEFAULT true,
        display_order     INTEGER NOT NULL DEFAULT 0,
        created_at        TIMESTAMP NOT NULL DEFAULT now(),
        updated_at        TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_leave_types_active_idx ON att_leave_types(is_active)`);
    steps.push("att_leave_types 생성");

    // 5. att_leave_balances
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS att_leave_balances (
        id            SERIAL PRIMARY KEY,
        member_uid    VARCHAR(36) NOT NULL,
        leave_type_id INTEGER NOT NULL REFERENCES att_leave_types(id) ON DELETE CASCADE,
        year          INTEGER NOT NULL,
        total_days    NUMERIC(5,2) NOT NULL DEFAULT 0,
        used_days     NUMERIC(5,2) NOT NULL DEFAULT 0,
        UNIQUE(member_uid, leave_type_id, year)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_leave_balances_member_idx ON att_leave_balances(member_uid)`);
    steps.push("att_leave_balances 생성");

    // 6. att_leave_requests
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS att_leave_requests (
        id            SERIAL PRIMARY KEY,
        member_uid    VARCHAR(36) NOT NULL,
        leave_type_id INTEGER NOT NULL REFERENCES att_leave_types(id),
        start_date    DATE NOT NULL,
        end_date      DATE NOT NULL,
        days          NUMERIC(5,2) NOT NULL,
        reason        TEXT,
        status        VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        reviewed_by   VARCHAR(36),
        review_note   TEXT,
        created_at    TIMESTAMP NOT NULL DEFAULT now(),
        updated_at    TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_leave_requests_member_idx ON att_leave_requests(member_uid)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_leave_requests_status_idx ON att_leave_requests(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_leave_requests_date_idx ON att_leave_requests(start_date)`);
    steps.push("att_leave_requests 생성");

    // 7. att_schedules
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS att_schedules (
        id              SERIAL PRIMARY KEY,
        member_uid      VARCHAR(36) NOT NULL,
        work_mode       VARCHAR(30) NOT NULL,
        recurring_rule  JSONB,
        start_date      DATE NOT NULL,
        end_date        DATE,
        workplace_id    INTEGER REFERENCES att_workplaces(id) ON DELETE SET NULL,
        note            TEXT,
        created_by      VARCHAR(36),
        created_at      TIMESTAMP NOT NULL DEFAULT now(),
        updated_at      TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_schedules_member_idx ON att_schedules(member_uid)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_schedules_start_idx ON att_schedules(start_date)`);
    steps.push("att_schedules 생성");

    // 8. att_schedule_overrides
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS att_schedule_overrides (
        id           SERIAL PRIMARY KEY,
        member_uid   VARCHAR(36) NOT NULL,
        date         DATE NOT NULL,
        work_mode    VARCHAR(30) NOT NULL,
        workplace_id INTEGER REFERENCES att_workplaces(id) ON DELETE SET NULL,
        reason       TEXT,
        created_by   VARCHAR(36),
        created_at   TIMESTAMP NOT NULL DEFAULT now(),
        UNIQUE(member_uid, date)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_overrides_member_idx ON att_schedule_overrides(member_uid)`);
    steps.push("att_schedule_overrides 생성");

    // 9. att_records
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS att_records (
        id                    SERIAL PRIMARY KEY,
        member_uid            VARCHAR(36) NOT NULL,
        date                  DATE NOT NULL,
        work_mode             VARCHAR(30),
        status                VARCHAR(30) NOT NULL DEFAULT 'NORMAL',
        check_in_time         TIMESTAMP,
        check_in_lat          NUMERIC(10,7),
        check_in_lng          NUMERIC(10,7),
        check_in_ip           VARCHAR(50),
        check_out_time        TIMESTAMP,
        check_out_lat         NUMERIC(10,7),
        check_out_lng         NUMERIC(10,7),
        workplace_id          INTEGER REFERENCES att_workplaces(id) ON DELETE SET NULL,
        working_mins          INTEGER,
        overtime_mins         INTEGER NOT NULL DEFAULT 0,
        is_manually_adjusted  BOOLEAN NOT NULL DEFAULT false,
        note                  TEXT,
        created_at            TIMESTAMP NOT NULL DEFAULT now(),
        updated_at            TIMESTAMP NOT NULL DEFAULT now(),
        UNIQUE(member_uid, date)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_records_member_idx ON att_records(member_uid)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_records_date_idx ON att_records(date)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_records_status_idx ON att_records(status)`);
    steps.push("att_records 생성");

    // 10. att_corrections
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS att_corrections (
        id                   SERIAL PRIMARY KEY,
        member_uid           VARCHAR(36) NOT NULL,
        target_date          DATE NOT NULL,
        correction_type      VARCHAR(20) NOT NULL,
        requested_check_in   TIMESTAMP,
        requested_check_out  TIMESTAMP,
        reason               TEXT,
        evidence_url         TEXT,
        status               VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        reviewed_by          VARCHAR(36),
        review_note          TEXT,
        created_at           TIMESTAMP NOT NULL DEFAULT now(),
        updated_at           TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_corrections_member_idx ON att_corrections(member_uid)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_corrections_status_idx ON att_corrections(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS att_corrections_date_idx ON att_corrections(target_date)`);
    steps.push("att_corrections 생성");

    // 기본 데이터 INSERT (idempotent)
    await db.execute(sql`
      INSERT INTO att_policies (name, is_default)
      SELECT '기본 근무 정책', true
      WHERE NOT EXISTS (SELECT 1 FROM att_policies WHERE is_default = true)
    `);
    steps.push("기본 근무 정책 INSERT");

    const leaveTypeSeeds = [
      { name: "연차", is_paid: true, unit: "day", default_days: 15, order: 1 },
      { name: "반차 (오전)", is_paid: true, unit: "day", default_days: 0, order: 2 },
      { name: "반차 (오후)", is_paid: true, unit: "day", default_days: 0, order: 3 },
      { name: "병가", is_paid: true, unit: "day", default_days: 5, order: 4 },
      { name: "경조사", is_paid: true, unit: "day", default_days: 0, order: 5 },
      { name: "무급휴가", is_paid: false, unit: "day", default_days: 0, order: 6 },
    ];
    for (const lt of leaveTypeSeeds) {
      await db.execute(sql`
        INSERT INTO att_leave_types (name, is_paid, unit, default_days, display_order)
        SELECT ${lt.name}, ${lt.is_paid}, ${lt.unit}, ${lt.default_days}, ${lt.order}
        WHERE NOT EXISTS (SELECT 1 FROM att_leave_types WHERE name = ${lt.name})
      `);
    }
    steps.push("기본 휴가 종류 6건 INSERT");

    return new Response(JSON.stringify({ ok: true, steps }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: "마이그레이션 실패",
      steps,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
