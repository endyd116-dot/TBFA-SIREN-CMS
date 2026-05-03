// netlify/functions/migrate-m6.ts
// ★ Phase M-6: harassment_reports 테이블 + ENUM 2개

import type { Context } from "@netlify/functions";
import postgres from "postgres";

export const config = { path: "/api/migrate-m6" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== "siren-m6-2026") {
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
  const log: string[] = [];

  try {
    /* 1) ENUM */
    try {
      await sql`CREATE TYPE harassment_category AS ENUM ('parent', 'student', 'admin', 'colleague', 'other')`;
      log.push("✅ ENUM harassment_category 생성");
    } catch (e: any) {
      if (e.code === "42710") log.push("ℹ️ ENUM harassment_category 이미 존재");
      else throw e;
    }
    try {
      await sql`CREATE TYPE harassment_report_status AS ENUM ('submitted', 'ai_analyzed', 'reviewing', 'responded', 'closed', 'rejected')`;
      log.push("✅ ENUM harassment_report_status 생성");
    } catch (e: any) {
      if (e.code === "42710") log.push("ℹ️ ENUM harassment_report_status 이미 존재");
      else throw e;
    }

    /* 2) 테이블 */
    await sql`
      CREATE TABLE IF NOT EXISTS harassment_reports (
        id SERIAL PRIMARY KEY,
        report_no VARCHAR(30) NOT NULL UNIQUE,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE SET NULL,
        category harassment_category NOT NULL DEFAULT 'parent',
        occurred_at TIMESTAMPTZ,
        frequency VARCHAR(30),
        title VARCHAR(200) NOT NULL,
        content_html TEXT NOT NULL,
        attachment_ids TEXT,
        is_anonymous BOOLEAN DEFAULT FALSE,
        reporter_name VARCHAR(50),
        reporter_phone VARCHAR(20),
        reporter_email VARCHAR(100),
        ai_category VARCHAR(30),
        ai_severity VARCHAR(20),
        ai_summary TEXT,
        ai_immediate_action TEXT,
        ai_legal_review_needed BOOLEAN,
        ai_legal_reason TEXT,
        ai_psych_support_needed BOOLEAN,
        ai_suggestion TEXT,
        ai_analyzed_at TIMESTAMPTZ,
        siren_report_requested BOOLEAN,
        siren_report_requested_at TIMESTAMPTZ,
        status harassment_report_status NOT NULL DEFAULT 'submitted',
        admin_response TEXT,
        responded_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
        responded_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS harassment_reports_report_no_idx ON harassment_reports(report_no)`;
    await sql`CREATE INDEX IF NOT EXISTS harassment_reports_member_idx ON harassment_reports(member_id)`;
    await sql`CREATE INDEX IF NOT EXISTS harassment_reports_status_idx ON harassment_reports(status)`;
    await sql`CREATE INDEX IF NOT EXISTS harassment_reports_severity_idx ON harassment_reports(ai_severity)`;
    await sql`CREATE INDEX IF NOT EXISTS harassment_reports_category_idx ON harassment_reports(category)`;
    log.push("✅ harassment_reports 테이블 생성");

    const cols = await sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'harassment_reports' ORDER BY ordinal_position
    `;

    await sql.end();

    return new Response(JSON.stringify({
      ok: true,
      message: "✅ Phase M-6 마이그레이션 완료",
      log,
      columnCount: cols.length,
    }, null, 2), {
      status: 200, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e: any) {
    await sql.end().catch(() => {});
    return new Response(JSON.stringify({ ok: false, error: e.message, log, stack: e.stack }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
};