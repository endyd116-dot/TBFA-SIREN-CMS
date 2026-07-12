// netlify/functions/admin-auto-trigger-runs.ts
// Phase 10 R4 — 자동 트리거 실행 이력 목록 (어드민)
//
// GET ?triggerId=X&limit=50&offset=0&status=ok|skipped|error

import { jsonKST } from "../../lib/kst";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-auto-trigger-runs" };

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const triggerId = Number(url.searchParams.get("triggerId"));
  if (!triggerId || isNaN(triggerId)) {
    return new Response(jsonKST({ ok: false, error: "트리거 ID(triggerId)가 필요합니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const limit  = Math.min(Number(url.searchParams.get("limit"))  || 50, 200);
  const offset = Number(url.searchParams.get("offset")) || 0;
  const status = url.searchParams.get("status") || null;

  try {
    const statusFilter = status ? sql`AND r.status = ${status}` : sql``;

    const rowsRes: any = await db.execute(sql`
      SELECT r.id, r.trigger_id, r.job_id, r.triggered_at,
             r.member_count, r.status, r.error, r.meta
        FROM communication_auto_trigger_runs r
       WHERE r.trigger_id = ${triggerId}
         ${statusFilter}
       ORDER BY r.triggered_at DESC
       LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = rowsRes?.rows ?? rowsRes ?? [];

    const totalRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n
        FROM communication_auto_trigger_runs r
       WHERE r.trigger_id = ${triggerId}
         ${statusFilter}
    `);
    const total = ((totalRes?.rows ?? totalRes)[0] ?? {}).n ?? 0;

    return new Response(
      jsonKST({ ok: true, rows, total }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      jsonKST({
        ok: false, error: "실행 이력 조회 실패",
        step: "select", detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
