// netlify/functions/migrate-phase3-workspace.ts
// ★ Phase 3 Step 1: 공통 워크스페이스 5개 테이블 생성

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/migrate-phase3-workspace" };

const MIGRATION_KEY = "siren-phase3-workspace-20260508";

export default async (req: Request, _ctx: Context) => {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("key") !== MIGRATION_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "invalid key" }),
        { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const results: string[] = [];

    // 1. workspace_tasks
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS workspace_tasks (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        title VARCHAR(300) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'todo' NOT NULL,
        priority VARCHAR(20) DEFAULT 'normal' NOT NULL,
        due_date TIMESTAMP NOT NULL,
        assigned_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
        assigned_at TIMESTAMP,
        parent_task_id INTEGER,
        tags JSONB DEFAULT '[]'::jsonb,
        sort_order INTEGER DEFAULT 0,
        completed_at TIMESTAMP,
        completed_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `));
    results.push("✅ workspace_tasks");

    for (const ddl of [
      `CREATE INDEX IF NOT EXISTS workspace_tasks_member_idx ON workspace_tasks(member_id)`,
      `CREATE INDEX IF NOT EXISTS workspace_tasks_status_idx ON workspace_tasks(status)`,
      `CREATE INDEX IF NOT EXISTS workspace_tasks_due_idx ON workspace_tasks(due_date)`,
      `CREATE INDEX IF NOT EXISTS workspace_tasks_assigned_by_idx ON workspace_tasks(assigned_by)`,
      `CREATE INDEX IF NOT EXISTS workspace_tasks_parent_idx ON workspace_tasks(parent_task_id)`,
    ]) await db.execute(sql.raw(ddl));
    results.push("✅ workspace_tasks 인덱스 5개");

    // 2. workspace_memos
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS workspace_memos (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        title VARCHAR(200),
        content_html TEXT,
        color VARCHAR(20) DEFAULT 'yellow' NOT NULL,
        is_pinned BOOLEAN DEFAULT false NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS workspace_memos_member_idx ON workspace_memos(member_id, sort_order)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS workspace_memos_pinned_idx ON workspace_memos(is_pinned)`));
    results.push("✅ workspace_memos + 인덱스 2개");

    // 3. workspace_events
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS workspace_events (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        title VARCHAR(300) NOT NULL,
        location VARCHAR(300),
        start_at TIMESTAMP NOT NULL,
        end_at TIMESTAMP NOT NULL,
        all_day BOOLEAN DEFAULT false NOT NULL,
        color VARCHAR(20) DEFAULT 'blue' NOT NULL,
        description TEXT,
        attendees JSONB DEFAULT '[]'::jsonb,
        external_ref VARCHAR(200),
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS workspace_events_member_idx ON workspace_events(member_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS workspace_events_start_idx ON workspace_events(start_at)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS workspace_events_range_idx ON workspace_events(start_at, end_at)`));
    results.push("✅ workspace_events + 인덱스 3개");

    // 4. task_due_change_requests
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS task_due_change_requests (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES workspace_tasks(id) ON DELETE CASCADE,
        requested_by INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        current_due TIMESTAMP NOT NULL,
        new_due TIMESTAMP NOT NULL,
        reason TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' NOT NULL,
        reviewed_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP,
        review_note TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS task_due_change_task_idx ON task_due_change_requests(task_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS task_due_change_requester_idx ON task_due_change_requests(requested_by)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS task_due_change_status_idx ON task_due_change_requests(status)`));
    results.push("✅ task_due_change_requests + 인덱스 3개");

    // 5. daily_briefings
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS daily_briefings (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        briefing_date DATE NOT NULL,
        urgent_count INTEGER DEFAULT 0 NOT NULL,
        today_due_count INTEGER DEFAULT 0 NOT NULL,
        tomorrow_due_count INTEGER DEFAULT 0 NOT NULL,
        new_assignments INTEGER DEFAULT 0 NOT NULL,
        summary_md TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `));
    await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_briefings_member_date ON daily_briefings(member_id, briefing_date)`));
    results.push("✅ daily_briefings + 유니크 인덱스");

    // 검증
    const verify: any = await db.execute(sql.raw(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('workspace_tasks','workspace_memos','workspace_events','task_due_change_requests','daily_briefings')
    `));
    const rows = Array.isArray(verify) ? verify : (verify as any).rows || [];
    results.push(`🔍 검증: ${rows.length}/5 테이블 확인됨`);

    return new Response(JSON.stringify({ ok: true, phase: "Phase 3 Step 1 - Workspace", results }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("[migrate-phase3] 실패:", error);
    return new Response(JSON.stringify({ ok: false, error: error?.message, stack: error?.stack }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
