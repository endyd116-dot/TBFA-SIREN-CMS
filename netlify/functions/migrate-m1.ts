// netlify/functions/migrate-m1.ts
// ★ Phase M-1: blob_uploads 테이블 생성용 1회용 마이그레이션
// 사용 후 즉시 삭제할 것

import type { Context } from "@netlify/functions";
import postgres from "postgres";

export const config = { path: "/api/migrate-m1" };

export default async (req: Request, _ctx: Context) => {
  // 보안: 비밀 키 확인 (단순 토큰)
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== "siren-m1-2026") {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const conn = process.env.NETLIFY_DATABASE_URL;
  if (!conn) {
    return new Response(
      JSON.stringify({ ok: false, error: "NETLIFY_DATABASE_URL not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const sql = postgres(conn, { max: 1, ssl: "require" });

  try {
    // 1) 테이블 생성 (IF NOT EXISTS - 중복 실행 안전)
    await sql`
      CREATE TABLE IF NOT EXISTS blob_uploads (
        id SERIAL PRIMARY KEY,
        blob_key VARCHAR(255) NOT NULL UNIQUE,
        original_name VARCHAR(500) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        size_bytes INTEGER NOT NULL,
        uploaded_by INTEGER,
        uploaded_by_admin INTEGER,
        context VARCHAR(50),
        reference_table VARCHAR(50),
        reference_id INTEGER,
        is_public BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ
      )
    `;

    // 2) 인덱스 생성
    await sql`CREATE INDEX IF NOT EXISTS idx_blob_uploads_key ON blob_uploads(blob_key)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_blob_uploads_ref ON blob_uploads(reference_table, reference_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_blob_uploads_expires ON blob_uploads(expires_at) WHERE expires_at IS NOT NULL`;

    // 3) 검증
    const tableCheck = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'blob_uploads' 
      ORDER BY ordinal_position
    `;

    await sql.end();

    return new Response(
      JSON.stringify({
        ok: true,
        message: "✅ blob_uploads 테이블 생성 완료",
        columns: tableCheck,
      }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  } catch (e: any) {
    await sql.end().catch(() => {});
    return new Response(
      JSON.stringify({ ok: false, error: e.message, stack: e.stack }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
};