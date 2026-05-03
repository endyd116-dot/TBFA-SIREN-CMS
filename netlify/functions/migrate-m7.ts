// netlify/functions/migrate-m7.ts
// ★ Phase M-7: legal_consultations 테이블 + ENUM 2개

import type { Context } from "@netlify/functions";
import postgres from "postgres";

export const config = { path: "/api/migrate-m7" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== "siren-m7-2026") {
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
    /* ENUM */
    try {
      await sql`CREATE TYPE legal_category AS ENUM ('school_dispute', 'civil', 'criminal', 'family', 'labor', 'contract', 'other')`;
      log.push("✅ ENUM legal_category 생성");
    } catch (e: any) {
      if (e.code === "42710") log.push("ℹ️ ENUM legal_category 이미 존재");
      else throw e;
    }
    try {
      await sql`CREATE TYPE legal_consultation_status AS ENUM ('submitted', 'ai_analyzed', 'matching', 'matched', 'in_progress', 'responded', 'closed', 'rejected')`;
      log.push("✅ ENUM legal_consultation_status 생성");
    } catch (e: any) {
      if (e.code === "42710") log.push("ℹ️ ENUM legal_consultation_status 이미 존재");
      else throw e;
    }

    /* 테이블 */
    await sql`
      CREATE TABLE IF NOT EXISTS legal_consultations (
        id SERIAL PRIMARY KEY,
        consultation_no VARCHAR(30) NOT NULL UNIQUE,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE SET NULL,
        category legal_category NOT NULL DEFAULT 'school_dispute',
        urgency VARCHAR(20),
        occurred_at TIMESTAMPTZ,
        party_info VARCHAR(200),
        title VARCHAR(200) NOT NULL,
        content_html TEXT NOT NULL,
        attachment_ids TEXT,
        is_anonymous BOOLEAN DEFAULT FALSE,
        reporter_name VARCHAR(50),
        reporter_phone VARCHAR(20),
        reporter_email VARCHAR(100),
        ai_category VARCHAR(30),
        ai_urgency VARCHAR(20),
        ai_summary TEXT,
        ai_related_laws TEXT,
        ai_legal_opinion TEXT,
        ai_lawyer_specialty VARCHAR(100),
        ai_immediate_action TEXT,
        ai_suggestion TEXT,
        ai_analyzed_at TIMESTAMPTZ,
        siren_report_requested BOOLEAN,
        siren_report_requested_at TIMESTAMPTZ,
        assigned_lawyer_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        assigned_lawyer_name VARCHAR(50),
        assigned_at TIMESTAMPTZ,
        status legal_consultation_status NOT NULL DEFAULT 'submitted',
        admin_response TEXT,
        responded_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
        responded_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS legal_consultations_no_idx ON legal_consultations(consultation_no)`;
    await sql`CREATE INDEX IF NOT EXISTS legal_consultations_member_idx ON legal_consultations(member_id)`;
    await sql`CREATE INDEX IF NOT EXISTS legal_consultations_status_idx ON legal_consultations(status)`;
    await sql`CREATE INDEX IF NOT EXISTS legal_consultations_urgency_idx ON legal_consultations(ai_urgency)`;
    await sql`CREATE INDEX IF NOT EXISTS legal_consultations_category_idx ON legal_consultations(category)`;
    log.push("✅ legal_consultations 테이블 생성");

    const cols = await sql`
      SELECT COUNT(*)::int AS cnt FROM information_schema.columns WHERE table_name = 'legal_consultations'
    `;

    await sql.end();

    return new Response(JSON.stringify({
      ok: true,
      message: "✅ Phase M-7 마이그레이션 완료",
      log,
      columnCount: cols[0].cnt,
    }, null, 2), {
      status: 200, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e: any) {
    await sql.end().catch(() => {});
    return new Response(JSON.stringify({ ok: false, error: e.message, log, stack: e.stack }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
};