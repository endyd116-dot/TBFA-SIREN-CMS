// netlify/functions/admin-send-job-detail.ts
// Phase 10 R3 — 발송 작업 단일 상세 (진행률·통계 포함)

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-send-job-detail" };

const JSON_HEADER = { "Content-Type": "application/json" };

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "발송 작업 상세 조회 실패",
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

  let job: any = null;
  let stats: any = { pending: 0, sending: 0, sent: 0, failed: 0, cancelled: 0 };

  try {
    const r: any = await db.execute(sql`
      SELECT j.id, j.name, j.template_id, j.recipient_group_id, j.channel,
             j.schedule_type, j.scheduled_at, j.status,
             j.total_recipients, j.success_count, j.failure_count,
             j.last_error, j.started_at, j.completed_at,
             j.created_by, j.created_at, j.updated_at,
             t.name AS template_name,
             g.name AS group_name
        FROM communication_send_jobs j
        LEFT JOIN communication_templates t ON t.id = j.template_id
        LEFT JOIN recipient_groups g ON g.id = j.recipient_group_id
        WHERE j.id = ${id}
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
    job = {
      id: row.id,
      name: row.name,
      templateId: row.template_id,
      templateName: row.template_name || null,
      recipientGroupId: row.recipient_group_id,
      groupName: row.group_name || null,
      channel: row.channel,
      scheduleType: row.schedule_type,
      scheduledAt: row.scheduled_at,
      status: row.status,
      totalRecipients: total,
      successCount: row.success_count,
      failureCount: row.failure_count,
      progressPercent,
      lastError: row.last_error,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (err: any) {
    return jsonError("select_job", err);
  }

  /* 보조 통계 — 실패해도 빈 객체 유지 */
  try {
    const sRes: any = await db.execute(sql`
      SELECT status, COUNT(*)::int AS n
        FROM communication_send_recipients
       WHERE job_id = ${id}
       GROUP BY status
    `);
    const arr = sRes?.rows ?? sRes ?? [];
    for (const r of arr) {
      if (r.status && stats.hasOwnProperty(r.status)) {
        stats[r.status] = r.n;
      } else if (r.status) {
        stats[r.status] = r.n;
      }
    }
  } catch (err) {
    console.warn("[admin-send-job-detail] recipient stats 실패", err);
  }

  return new Response(
    JSON.stringify({ ok: true, job: { ...job, recipientStats: stats } }),
    { status: 200, headers: JSON_HEADER },
  );
}
