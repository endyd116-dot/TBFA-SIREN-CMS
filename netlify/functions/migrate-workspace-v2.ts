// netlify/functions/migrate-workspace-v2.ts
// ★ Phase 3 Step 1.5 — 워크스페이스 고도화 (옵션 A) DB 마이그레이션
// 호출: /migrate-workspace-v2?key=siren-ws-v2-20260508
// ★ 호출 후 즉시 파일 삭제 필수 (보안)

import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/migrate-workspace-v2" };

const SECRET_KEY = "siren-ws-v2-20260508";

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");

  if (key !== SECRET_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid key" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const log: string[] = [];
  const errors: string[] = [];

  try {
    /* ════════════════════════════════════════════════
       1. workspace_tasks — 11개 컬럼 + 3개 인덱스
    ════════════════════════════════════════════════ */
    log.push("─── [1] workspace_tasks 확장 ───");
    await db.execute(sql`
      ALTER TABLE workspace_tasks
        ADD COLUMN IF NOT EXISTS assigned_to integer REFERENCES members(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS source_type varchar(30),
        ADD COLUMN IF NOT EXISTS source_id integer,
        ADD COLUMN IF NOT EXISTS source_ref_url varchar(500),
        ADD COLUMN IF NOT EXISTS checklist_items jsonb DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS reminder_config jsonb DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS reminders_sent_at jsonb DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS recurring_parent_id integer,
        ADD COLUMN IF NOT EXISTS created_by_agent varchar(20)
    `);
    log.push("  ✅ 11개 컬럼 추가");

    await db.execute(sql`CREATE INDEX IF NOT EXISTS workspace_tasks_assigned_to_idx ON workspace_tasks(assigned_to)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS workspace_tasks_source_idx ON workspace_tasks(source_type, source_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS workspace_tasks_recurring_idx ON workspace_tasks(recurring_parent_id)`);
    log.push("  ✅ 3개 인덱스 추가");

    /* ════════════════════════════════════════════════
       2. workspace_memos — 3개 컬럼
    ════════════════════════════════════════════════ */
    log.push("─── [2] workspace_memos 확장 ───");
    await db.execute(sql`
      ALTER TABLE workspace_memos
        ADD COLUMN IF NOT EXISTS related_task_id integer,
        ADD COLUMN IF NOT EXISTS related_event_id integer,
        ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb
    `);
    log.push("  ✅ 3개 컬럼 추가");

    /* ════════════════════════════════════════════════
       3. workspace_events — 8개 컬럼 + 2개 인덱스
    ════════════════════════════════════════════════ */
    log.push("─── [3] workspace_events 확장 ───");
    await db.execute(sql`
      ALTER TABLE workspace_events
        ADD COLUMN IF NOT EXISTS event_type varchar(30) NOT NULL DEFAULT 'general',
        ADD COLUMN IF NOT EXISTS source_type varchar(30),
        ADD COLUMN IF NOT EXISTS source_id integer,
        ADD COLUMN IF NOT EXISTS recurring_rule varchar(200),
        ADD COLUMN IF NOT EXISTS recurring_parent_id integer,
        ADD COLUMN IF NOT EXISTS reminder_config jsonb DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS reminders_sent_at jsonb DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS created_by_agent varchar(20)
    `);
    log.push("  ✅ 8개 컬럼 추가");

    await db.execute(sql`CREATE INDEX IF NOT EXISTS workspace_events_type_idx ON workspace_events(event_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS workspace_events_source_idx ON workspace_events(source_type, source_id)`);
    log.push("  ✅ 2개 인덱스 추가");

    /* ════════════════════════════════════════════════
       4. daily_briefings — 7개 컬럼
    ════════════════════════════════════════════════ */
    log.push("─── [4] daily_briefings 확장 ───");
    await db.execute(sql`
      ALTER TABLE daily_briefings
        ADD COLUMN IF NOT EXISTS overdue_count integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS in_progress_count integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS completed_yesterday_count integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS today_events_count integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS risk_alerts jsonb DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS ai_suggestions jsonb DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS read_at timestamp
    `);
    log.push("  ✅ 7개 컬럼 추가");

    /* ════════════════════════════════════════════════
       5. workspace_notifications (신규 테이블)
    ════════════════════════════════════════════════ */
    log.push("─── [5] workspace_notifications 생성 ───");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS workspace_notifications (
        id serial PRIMARY KEY,
        member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        source_type varchar(20) NOT NULL,
        source_id integer NOT NULL,
        notif_type varchar(30) NOT NULL,
        channel varchar(20) NOT NULL,
        title varchar(300) NOT NULL,
        body text,
        action_url varchar(500),
        sent_at timestamp NOT NULL DEFAULT now(),
        read_at timestamp,
        delivery_status varchar(20) NOT NULL DEFAULT 'sent',
        error_message text
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_notifs_member_idx ON workspace_notifications(member_id, read_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_notifs_source_idx ON workspace_notifications(source_type, source_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_notifs_type_idx ON workspace_notifications(notif_type)`);
    log.push("  ✅ 테이블 + 3개 인덱스 생성");

    /* ════════════════════════════════════════════════
       6. workspace_activity_log (신규 테이블)
    ════════════════════════════════════════════════ */
    log.push("─── [6] workspace_activity_log 생성 ───");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS workspace_activity_log (
        id serial PRIMARY KEY,
        actor_id integer REFERENCES members(id) ON DELETE SET NULL,
        actor_name varchar(100),
        action_type varchar(40) NOT NULL,
        target_type varchar(20),
        target_id integer,
        target_title varchar(300),
        metadata jsonb DEFAULT '{}'::jsonb,
        visibility varchar(20) NOT NULL DEFAULT 'team',
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_activity_actor_idx ON workspace_activity_log(actor_id, created_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_activity_target_idx ON workspace_activity_log(target_type, target_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_activity_type_idx ON workspace_activity_log(action_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_activity_date_idx ON workspace_activity_log(created_at)`);
    log.push("  ✅ 테이블 + 4개 인덱스 생성");

    /* ════════════════════════════════════════════════
       7. 검증 쿼리
    ════════════════════════════════════════════════ */
    log.push("─── [7] 검증 ───");
    const taskCols: any = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='workspace_tasks'
      AND column_name IN ('assigned_to','progress','source_type','source_id','source_ref_url',
                          'checklist_items','attachments','reminder_config','reminders_sent_at',
                          'recurring_parent_id','created_by_agent')
      ORDER BY column_name
    `);
    const taskRows = Array.isArray(taskCols) ? taskCols : (taskCols as any).rows || [];
    log.push(`  workspace_tasks 신규 컬럼: ${taskRows.length}/11`);

    const eventCols: any = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='workspace_events'
      AND column_name IN ('event_type','source_type','source_id','recurring_rule',
                          'recurring_parent_id','reminder_config','reminders_sent_at','created_by_agent')
      ORDER BY column_name
    `);
    const eventRows = Array.isArray(eventCols) ? eventCols : (eventCols as any).rows || [];
    log.push(`  workspace_events 신규 컬럼: ${eventRows.length}/8`);

    const briefCols: any = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='daily_briefings'
      AND column_name IN ('overdue_count','in_progress_count','completed_yesterday_count',
                          'today_events_count','risk_alerts','ai_suggestions','read_at')
      ORDER BY column_name
    `);
    const briefRows = Array.isArray(briefCols) ? briefCols : (briefCols as any).rows || [];
    log.push(`  daily_briefings 신규 컬럼: ${briefRows.length}/7`);

    const memoCols: any = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='workspace_memos'
      AND column_name IN ('related_task_id','related_event_id','attachments')
      ORDER BY column_name
    `);
    const memoRows = Array.isArray(memoCols) ? memoCols : (memoCols as any).rows || [];
    log.push(`  workspace_memos 신규 컬럼: ${memoRows.length}/3`);

    const newTables: any = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('workspace_notifications','workspace_activity_log')
      ORDER BY table_name
    `);
    const tableRows = Array.isArray(newTables) ? newTables : (newTables as any).rows || [];
    log.push(`  신규 테이블: ${tableRows.length}/2`);

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Phase 3 Step 1.5 워크스페이스 고도화 완료",
        log,
        verification: {
          workspace_tasks_new_cols: taskRows.length,
          workspace_events_new_cols: eventRows.length,
          daily_briefings_new_cols: briefRows.length,
          workspace_memos_new_cols: memoRows.length,
          new_tables: tableRows.length,
        },
        errors,
      }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    errors.push(String(err?.message || err));
    return new Response(
      JSON.stringify({ ok: false, error: err?.message, log, errors }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
