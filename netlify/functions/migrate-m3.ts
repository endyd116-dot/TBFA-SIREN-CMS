// netlify/functions/migrate-m3.ts
// ★ Phase M-3: notifications 테이블 생성

import type { Context } from "@netlify/functions";
import postgres from "postgres";

export const config = { path: "/api/migrate-m3" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== "siren-m3-2026") {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const conn = process.env.NETLIFY_DATABASE_URL;
  if (!conn) {
    return new Response(JSON.stringify({ ok: false, error: "NETLIFY_DATABASE_URL not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const sql = postgres(conn, { max: 1, ssl: "require" });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        recipient_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        recipient_type VARCHAR(20) NOT NULL DEFAULT 'user',
        category VARCHAR(30) NOT NULL,
        severity VARCHAR(20) NOT NULL DEFAULT 'info',
        title VARCHAR(200) NOT NULL,
        message VARCHAR(500),
        link VARCHAR(500),
        ref_table VARCHAR(50),
        ref_id INTEGER,
        is_read BOOLEAN DEFAULT FALSE,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        expires_at TIMESTAMPTZ
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications(recipient_id, is_read, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS notifications_category_idx ON notifications(category)`;
    await sql`CREATE INDEX IF NOT EXISTS notifications_severity_idx ON notifications(severity)`;
    await sql`CREATE INDEX IF NOT EXISTS notifications_expires_idx ON notifications(expires_at) WHERE expires_at IS NOT NULL`;

    const cols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'notifications'
      ORDER BY ordinal_position
    `;

    await sql.end();

    return new Response(JSON.stringify({
      ok: true,
      message: "✅ notifications 테이블 생성 완료",
      columns: cols,
    }, null, 2), {
      status: 200, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e: any) {
    await sql.end().catch(() => {});
    return new Response(JSON.stringify({ ok: false, error: e.message, stack: e.stack }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
};