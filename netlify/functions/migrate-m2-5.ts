// netlify/functions/migrate-m2-5.ts
// ★ Phase M-2.5: blob_uploads에 storage_provider, upload_status 컬럼 추가
// 사용 후 즉시 삭제할 것

import type { Context } from "@netlify/functions";
import postgres from "postgres";

export const config = { path: "/api/migrate-m2-5" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== "siren-m2-5-2026") {
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
    await sql`ALTER TABLE blob_uploads ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(20) NOT NULL DEFAULT 'netlify'`;
    await sql`ALTER TABLE blob_uploads ADD COLUMN IF NOT EXISTS upload_status VARCHAR(20) NOT NULL DEFAULT 'completed'`;

    const cols = await sql`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'blob_uploads'
        AND column_name IN ('storage_provider', 'upload_status')
      ORDER BY column_name
    `;

    await sql.end();

    return new Response(
      JSON.stringify({
        ok: true,
        message: "✅ blob_uploads 컬럼 추가 완료",
        columns: cols,
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