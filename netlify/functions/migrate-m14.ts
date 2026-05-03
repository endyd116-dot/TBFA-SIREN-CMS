// netlify/functions/migrate-m14.ts
// ★ Phase M-14: 영수증 설정에 stamp_blob_id, donations에 receipt_blob_id 컬럼 추가

import type { Context } from "@netlify/functions";
import postgres from "postgres";

export const config = { path: "/api/migrate-m14" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== "siren-m14-2026") {
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
    await sql`ALTER TABLE receipt_settings ADD COLUMN IF NOT EXISTS stamp_blob_id INTEGER`;
    log.push("✅ receipt_settings.stamp_blob_id 추가");

    await sql`ALTER TABLE donations ADD COLUMN IF NOT EXISTS receipt_blob_id INTEGER`;
    log.push("✅ donations.receipt_blob_id 추가");

    await sql`CREATE INDEX IF NOT EXISTS donations_receipt_blob_idx ON donations(receipt_blob_id) WHERE receipt_blob_id IS NOT NULL`;
    log.push("✅ donations.receipt_blob_id 인덱스 추가");

    /* 검증 */
    const cols = await sql`
      SELECT column_name, table_name
      FROM information_schema.columns
      WHERE (table_name = 'receipt_settings' AND column_name = 'stamp_blob_id')
         OR (table_name = 'donations' AND column_name = 'receipt_blob_id')
    `;

    await sql.end();

    return new Response(JSON.stringify({
      ok: true,
      message: "✅ Phase M-14 마이그레이션 완료",
      log,
      verification: cols,
    }, null, 2), {
      status: 200, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e: any) {
    await sql.end().catch(() => {});
    return new Response(JSON.stringify({ ok: false, error: e.message, log, stack: e.stack }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
};