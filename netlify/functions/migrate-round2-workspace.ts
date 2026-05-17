import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-round2-workspace" };

export default async function handler(req: Request, context: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run");

  if (run !== "1") {
    return new Response(
      JSON.stringify({
        ok: true,
        mode: "dry-run",
        message: "진단 모드. ?run=1 로 실행",
        tables: ["workspace_task_mentions", "workspace_event_rsvps", "google_calendar_tokens"],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const results: string[] = [];

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS workspace_task_mentions (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL,
        task_id INTEGER NOT NULL,
        mentioned_member_id INTEGER NOT NULL,
        mentioner_member_id INTEGER,
        context TEXT,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        read_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    results.push("workspace_task_mentions: OK");
  } catch (err) {
    results.push(`workspace_task_mentions: FAIL — ${String(err)}`);
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS workspace_event_rsvps (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        member_id INTEGER NOT NULL,
        status VARCHAR(10) NOT NULL,
        note VARCHAR(200),
        responded_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT workspace_event_rsvps_uniq UNIQUE (event_id, member_id)
      )
    `);
    results.push("workspace_event_rsvps: OK");
  } catch (err) {
    results.push(`workspace_event_rsvps: FAIL — ${String(err)}`);
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS google_calendar_tokens (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL UNIQUE,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        calendar_id VARCHAR(200) DEFAULT 'primary',
        sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        last_sync_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    results.push("google_calendar_tokens: OK");
  } catch (err) {
    results.push(`google_calendar_tokens: FAIL — ${String(err)}`);
  }

  return new Response(
    JSON.stringify({ ok: true, results }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
