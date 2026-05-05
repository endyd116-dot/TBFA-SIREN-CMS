import { db } from "../../db";
import { sql } from "drizzle-orm";

export default async (req: Request) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== "siren-fix-campaign-2026") {
    return new Response(JSON.stringify({ ok: false, error: "invalid key" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result: any = await db.execute(sql`
      UPDATE campaigns 
      SET status = 'active' 
      WHERE id = 1 AND status = 'draft'
      RETURNING id, slug, title, status, is_published
    `);
    const rows = Array.isArray(result) ? result : (result?.rows || []);
    return new Response(JSON.stringify({ ok: true, updated: rows.length, rows }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || "migration failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};