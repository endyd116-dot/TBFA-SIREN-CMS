// netlify/functions/migrate-incidents-fix.ts
// ★ 1회용 마이그레이션 — incidents + incident_reports 테이블 누락 보정
// 호출: GET /.netlify/functions/migrate-incidents-fix?key=siren-incidents-fix-2026
// 응답 ok:true 확인 후 즉시 이 파일 삭제 + git push (보안)

import type { Handler } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

const KEY = "siren-incidents-fix-2026";

export const handler: Handler = async (event) => {
  if (event.queryStringParameters?.key !== KEY) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, error: "Unauthorized" }) };
  }

  const log: string[] = [];

  try {
    /* ===== ENUM 타입 (있으면 스킵) ===== */
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE incident_category AS ENUM ('school', 'public', 'other');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    log.push("✅ incident_category ENUM");

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE incident_report_status AS ENUM (
          'submitted', 'ai_analyzed', 'reviewing',
          'responded', 'closed', 'rejected'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    log.push("✅ incident_report_status ENUM");

    /* ===== incidents 테이블 ===== */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS incidents (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(100) NOT NULL UNIQUE,
        title VARCHAR(200) NOT NULL,
        summary VARCHAR(500),
        content_html TEXT,
        thumbnail_blob_id INTEGER,
        occurred_at TIMESTAMP,
        location VARCHAR(200),
        category incident_category DEFAULT 'school' NOT NULL,
        status VARCHAR(20) DEFAULT 'active' NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS incidents_slug_idx ON incidents(slug)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS incidents_sort_idx ON incidents(sort_order)`);
    log.push("✅ incidents 테이블 생성");

    /* ===== incident_reports 테이블 ===== */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS incident_reports (
        id SERIAL PRIMARY KEY,
        report_no VARCHAR(30) NOT NULL UNIQUE,
        incident_id INTEGER REFERENCES incidents(id) ON DELETE SET NULL,
        member_id INTEGER REFERENCES members(id) ON DELETE SET NULL NOT NULL,
        title VARCHAR(200) NOT NULL,
        content_html TEXT NOT NULL,
        attachment_ids TEXT,
        is_anonymous BOOLEAN DEFAULT false,
        reporter_name VARCHAR(50),
        reporter_phone VARCHAR(20),
        reporter_email VARCHAR(100),
        ai_severity VARCHAR(20),
        ai_summary TEXT,
        ai_suggestion TEXT,
        ai_analyzed_at TIMESTAMP,
        siren_report_requested BOOLEAN,
        siren_report_requested_at TIMESTAMP,
        status incident_report_status DEFAULT 'submitted' NOT NULL,
        admin_response TEXT,
        responded_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
        responded_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ir_report_no_idx ON incident_reports(report_no)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ir_incident_idx ON incident_reports(incident_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ir_member_idx ON incident_reports(member_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ir_status_idx ON incident_reports(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ir_severity_idx ON incident_reports(ai_severity)`);
    log.push("✅ incident_reports 테이블 생성");

    /* ===== 시드: 샘플 사건 1건 (테스트용) ===== */
    const seed: any = await db.execute(sql`
      INSERT INTO incidents (slug, title, summary, category, status, sort_order)
      VALUES (
        'sample-2023-incident',
        '교권 침해 사례 (샘플)',
        '관리자가 직접 사건을 등록하기 전 임시 표시용 샘플입니다.',
        'school',
        'active',
        1
      )
      ON CONFLICT (slug) DO NOTHING
      RETURNING id
    `);
    const seedRows = Array.isArray(seed) ? seed : (seed?.rows || []);
    log.push(`✅ 샘플 사건 시드 ${seedRows.length > 0 ? '1건' : '(이미 존재)'}`);

    /* ===== 검증 ===== */
    const verify: any = await db.execute(sql`
      SELECT 
        (SELECT COUNT(*)::int FROM incidents) AS incidents_count,
        (SELECT COUNT(*)::int FROM incident_reports) AS reports_count
    `);
    const v = (verify.rows || verify || [{}])[0];

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        log,
        verify: {
          incidentsCount: v.incidents_count || 0,
          reportsCount: v.reports_count || 0,
        },
      }, null, 2),
    };
  } catch (e: any) {
    log.push(`❌ ${e.message}`);
    console.error("[migrate-incidents-fix]", e);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: e.message, log }, null, 2),
    };
  }
};