// netlify/functions/admin-send-job-progress.ts
// Phase 10 R3 — 진행률 폴링용 가벼운 응답 (5~10초 간격 호출 가정)

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-send-job-progress" };

const JSON_HEADER = { "Content-Type": "application/json" };

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "진행률 조회 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: JSON_HEADER },
  );
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response(
      JSON.stringify({ ok: false, error: "id가 올바르지 않습니다.", step: "validate" }),
      { status: 400, headers: JSON_HEADER },
    );
  }

  try {
    const r: any = await db.execute(sql`
      SELECT status, total_recipients, success_count, failure_count, last_error
        FROM communication_send_jobs
       WHERE id = ${id}
       LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) {
      return new Response(
        JSON.stringify({ ok: false, error: "발송 작업을 찾을 수 없습니다.", step: "not_found" }),
        { status: 404, headers: JSON_HEADER },
      );
    }
    const total = row.total_recipients || 0;
    const done = (row.success_count || 0) + (row.failure_count || 0);
    const progressPercent = total > 0 ? Math.round((done / total) * 1000) / 10 : 0;
    return new Response(
      JSON.stringify({
        ok: true,
        progress: {
          status: row.status,
          totalRecipients: total,
          successCount: row.success_count,
          failureCount: row.failure_count,
          progressPercent,
          lastError: row.last_error,
        },
      }),
      { status: 200, headers: JSON_HEADER },
    );
  } catch (err: any) {
    return jsonError("select_progress", err);
  }
}
