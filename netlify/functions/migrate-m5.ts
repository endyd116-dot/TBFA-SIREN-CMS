// netlify/functions/migrate-m5.ts
// ★ Phase M-5: incidents + incident_reports 테이블 + 시드 2건

import type { Context } from "@netlify/functions";
import postgres from "postgres";

export const config = { path: "/api/migrate-m5" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== "siren-m5-2026") {
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
    /* 1) ENUM 생성 */
    try {
      await sql`CREATE TYPE incident_category AS ENUM ('school', 'public', 'other')`;
      log.push("✅ ENUM incident_category 생성");
    } catch (e: any) {
      if (e.code === "42710") log.push("ℹ️ ENUM incident_category 이미 존재");
      else throw e;
    }
    try {
      await sql`CREATE TYPE incident_report_status AS ENUM ('submitted', 'ai_analyzed', 'reviewing', 'responded', 'closed', 'rejected')`;
      log.push("✅ ENUM incident_report_status 생성");
    } catch (e: any) {
      if (e.code === "42710") log.push("ℹ️ ENUM incident_report_status 이미 존재");
      else throw e;
    }

    /* 2) incidents 테이블 */
    await sql`
      CREATE TABLE IF NOT EXISTS incidents (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(100) NOT NULL UNIQUE,
        title VARCHAR(200) NOT NULL,
        summary VARCHAR(500),
        content_html TEXT,
        thumbnail_blob_id INTEGER,
        occurred_at TIMESTAMPTZ,
        location VARCHAR(200),
        category incident_category NOT NULL DEFAULT 'school',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS incidents_slug_idx ON incidents(slug)`;
    await sql`CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents(status)`;
    await sql`CREATE INDEX IF NOT EXISTS incidents_sort_idx ON incidents(sort_order)`;
    log.push("✅ incidents 테이블 생성");

    /* 3) incident_reports 테이블 */
    await sql`
      CREATE TABLE IF NOT EXISTS incident_reports (
        id SERIAL PRIMARY KEY,
        report_no VARCHAR(30) NOT NULL UNIQUE,
        incident_id INTEGER REFERENCES incidents(id) ON DELETE SET NULL,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE SET NULL,
        title VARCHAR(200) NOT NULL,
        content_html TEXT NOT NULL,
        attachment_ids TEXT,
        is_anonymous BOOLEAN DEFAULT FALSE,
        reporter_name VARCHAR(50),
        reporter_phone VARCHAR(20),
        reporter_email VARCHAR(100),
        ai_severity VARCHAR(20),
        ai_summary TEXT,
        ai_suggestion TEXT,
        ai_analyzed_at TIMESTAMPTZ,
        siren_report_requested BOOLEAN,
        siren_report_requested_at TIMESTAMPTZ,
        status incident_report_status NOT NULL DEFAULT 'submitted',
        admin_response TEXT,
        responded_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
        responded_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS incident_reports_report_no_idx ON incident_reports(report_no)`;
    await sql`CREATE INDEX IF NOT EXISTS incident_reports_incident_idx ON incident_reports(incident_id)`;
    await sql`CREATE INDEX IF NOT EXISTS incident_reports_member_idx ON incident_reports(member_id)`;
    await sql`CREATE INDEX IF NOT EXISTS incident_reports_status_idx ON incident_reports(status)`;
    await sql`CREATE INDEX IF NOT EXISTS incident_reports_severity_idx ON incident_reports(ai_severity)`;
    log.push("✅ incident_reports 테이블 생성");

    /* 4) 시드 2건 (이미 있으면 스킵) */
    const [seoyicho] = await sql`SELECT id FROM incidents WHERE slug = 'seoyicho-2023'`;
    if (!seoyicho) {
      await sql`
        INSERT INTO incidents (slug, title, summary, content_html, occurred_at, location, category, status, sort_order)
        VALUES (
          'seoyicho-2023',
          '서이초 사건',
          '2023년 7월, 서울 서초구 서이초등학교 1학년 담임교사가 학교 안에서 안타깝게 생을 마감한 사건입니다.',
          '<h2>서이초 사건 개요</h2><p>2023년 7월 18일, 서울특별시 서초구 서이초등학교에서 1학년 담임교사가 학교 내에서 사망한 채 발견된 사건입니다.</p><p>이 사건을 계기로 교사들의 정당한 교육활동을 보호하기 위한 사회적 논의가 본격화되었으며, 교권 보호 4법 개정의 직접적 계기가 되었습니다.</p><h3>주요 경과</h3><ul><li>2023.07.18 — 사건 발생</li><li>2023.07~09 — 전국적 추모 집회 및 49재 추모대회</li><li>2023.09.21 — 교권 보호 4법 국회 통과</li></ul><p>이 사건과 관련하여 추가로 알고 계신 정보나 증언이 있으시면 본 페이지를 통해 제보해 주시기 바랍니다.</p>',
          '2023-07-18 00:00:00+00',
          '서울특별시 서초구 서이초등학교',
          'school',
          'active',
          1
        )
      `;
      log.push("✅ 시드: 서이초 사건 (slug=seoyicho-2023)");
    } else {
      log.push("ℹ️ 서이초 사건 이미 존재");
    }

    const [jeju] = await sql`SELECT id FROM incidents WHERE slug = 'jeju-teacher-2023'`;
    if (!jeju) {
      await sql`
        INSERT INTO incidents (slug, title, summary, content_html, occurred_at, location, category, status, sort_order)
        VALUES (
          'jeju-teacher-2023',
          '제주 교사 사망 사건',
          '2023년 9월, 제주 지역 한 초등학교 교사가 안타깝게 생을 마감한 사건입니다.',
          '<h2>제주 교사 사망 사건 개요</h2><p>2023년 9월, 제주 지역 한 초등학교 교사가 학부모 민원과 학교 내 갈등 속에서 안타깝게 생을 마감한 사건입니다.</p><p>본 사건은 서이초 사건과 함께 교권 침해 문제의 심각성을 다시 한번 환기시키는 계기가 되었습니다.</p><h3>관련 정보</h3><ul><li>발생 시기: 2023년 9월</li><li>관련 이슈: 학부모 민원, 교내 갈등</li></ul><p>이 사건과 관련하여 추가 정보나 증언이 있으시면 제보해 주시기 바랍니다. 모든 제보는 비밀이 보장됩니다.</p>',
          '2023-09-01 00:00:00+00',
          '제주특별자치도',
          'school',
          'active',
          2
        )
      `;
      log.push("✅ 시드: 제주 교사 사망 사건 (slug=jeju-teacher-2023)");
    } else {
      log.push("ℹ️ 제주 교사 사망 사건 이미 존재");
    }

    /* 5) 검증 */
    const incidentCount = await sql`SELECT COUNT(*)::int AS cnt FROM incidents`;
    const reportCount = await sql`SELECT COUNT(*)::int AS cnt FROM incident_reports`;

    await sql.end();

    return new Response(JSON.stringify({
      ok: true,
      message: "✅ Phase M-5 마이그레이션 완료",
      log,
      verification: {
        incidentsCount: incidentCount[0].cnt,
        reportsCount: reportCount[0].cnt,
      },
    }, null, 2), {
      status: 200, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e: any) {
    await sql.end().catch(() => {});
    return new Response(JSON.stringify({ ok: false, error: e.message, log, stack: e.stack }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
};