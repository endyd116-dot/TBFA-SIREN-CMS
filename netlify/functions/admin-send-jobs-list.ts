// netlify/functions/admin-send-jobs-list.ts
// Phase 10 R3 — 발송 작업 목록 (status·기간·검색·페이지네이션)

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-send-jobs-list" };

const JSON_HEADER = { "Content-Type": "application/json" };

const VALID_STATUS = ["pending", "processing", "completed", "failed", "cancelled"];

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "발송 작업 목록 조회 실패",
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
  const status = url.searchParams.get("status") || "";
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  const q = url.searchParams.get("q") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

  let rows: any[] = [];
  let total = 0;

  try {
    const conditions: ReturnType<typeof sql>[] = [];
    if (status && VALID_STATUS.includes(status)) {
      conditions.push(sql`j.status = ${status}`);
    }
    if (from) {
      conditions.push(sql`j.created_at >= ${from}::timestamp`);
    }
    if (to) {
      conditions.push(sql`j.created_at <= ${to}::timestamp`);
    }
    if (q) {
      conditions.push(sql`j.name ILIKE ${"%" + q + "%"}`);
    }

    const whereFragment =
      conditions.length > 0
        ? sql`WHERE ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`
        : sql``;

    const rowsRes: any = await db.execute(sql`
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
        ${whereFragment}
        ORDER BY j.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
    `);
    rows = (rowsRes?.rows ?? rowsRes ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      templateId: r.template_id,
      templateName: r.template_name || null,
      recipientGroupId: r.recipient_group_id,
      groupName: r.group_name || null,
      channel: r.channel,
      scheduleType: r.schedule_type,
      scheduledAt: r.scheduled_at,
      status: r.status,
      /* ★ 버그픽스 #14: NULL → 0 정규화 (목록 진행률 카운트 0 표시 방지) */
      totalRecipients: Number(r.total_recipients) || 0,
      successCount: Number(r.success_count) || 0,
      failureCount: Number(r.failure_count) || 0,
      lastError: r.last_error,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    const cntRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n
        FROM communication_send_jobs j
        ${whereFragment}
    `);
    total = ((cntRes?.rows ?? cntRes)[0] ?? {}).n ?? 0;
  } catch (err: any) {
    return jsonError("select_jobs", err);
  }

  return new Response(
    JSON.stringify({ ok: true, rows, total }),
    { status: 200, headers: JSON_HEADER },
  );
}
