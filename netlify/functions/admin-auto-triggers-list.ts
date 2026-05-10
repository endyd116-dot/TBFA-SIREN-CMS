// netlify/functions/admin-auto-triggers-list.ts
// Phase 10 R4 — 자동 트리거 목록 (어드민)
//
// GET ?isActive=true|false|&limit=50&offset=0

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-auto-triggers-list" };

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const isActiveParam = url.searchParams.get("isActive");
  const limit  = Math.min(Number(url.searchParams.get("limit"))  || 50, 200);
  const offset = Number(url.searchParams.get("offset")) || 0;

  try {
    const activeFilter =
      isActiveParam === "true"  ? sql`AND t.is_active = true`  :
      isActiveParam === "false" ? sql`AND t.is_active = false` :
      sql``;

    const rowsRes: any = await db.execute(sql`
      SELECT t.id,
             t.name,
             t.description,
             t.trigger_type,
             t.template_id,
             ct.name AS template_name,
             t.channel,
             t.delay_hours,
             t.is_active,
             t.cooldown_days,
             t.conditions,
             t.created_at,
             t.updated_at,
             (SELECT COUNT(*)::int FROM communication_auto_trigger_runs r
               WHERE r.trigger_id = t.id AND r.status = 'ok') AS run_count
        FROM communication_auto_triggers t
        LEFT JOIN communication_templates ct ON ct.id = t.template_id
       WHERE t.deleted_at IS NULL
         ${activeFilter}
       ORDER BY t.is_active DESC, t.created_at DESC
       LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = rowsRes?.rows ?? rowsRes ?? [];

    const totalRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n
        FROM communication_auto_triggers t
       WHERE t.deleted_at IS NULL
         ${activeFilter}
    `);
    const total = ((totalRes?.rows ?? totalRes)[0] ?? {}).n ?? 0;

    return new Response(
      JSON.stringify({ ok: true, rows, total }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "트리거 목록 조회 실패",
        step: "select", detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
