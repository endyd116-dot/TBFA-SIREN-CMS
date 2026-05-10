// netlify/functions/admin-send-job-recipients.ts
// Phase 10 R3 — 작업의 수신자 목록 (status 필터·페이지네이션)

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-send-job-recipients" };

const JSON_HEADER = { "Content-Type": "application/json" };

const VALID_STATUS = ["pending", "sending", "sent", "failed", "cancelled"];

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "수신자 목록 조회 실패",
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
  const status = url.searchParams.get("status") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

  if (!Number.isInteger(id) || id <= 0) {
    return new Response(
      JSON.stringify({ ok: false, error: "id가 올바르지 않습니다.", step: "validate" }),
      { status: 400, headers: JSON_HEADER },
    );
  }

  let rows: any[] = [];
  let total = 0;

  try {
    const conditions: ReturnType<typeof sql>[] = [sql`r.job_id = ${id}`];
    if (status && VALID_STATUS.includes(status)) {
      conditions.push(sql`r.status = ${status}`);
    }
    const whereFragment = sql`WHERE ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`;

    const rowsRes: any = await db.execute(sql`
      SELECT r.id, r.member_id, r.channel, r.status, r.sent_at, r.error,
             r.retry_count, r.rendered_subject, r.created_at,
             m.name AS member_name, m.email AS member_email, m.phone AS member_phone
        FROM communication_send_recipients r
        LEFT JOIN members m ON m.id = r.member_id
        ${whereFragment}
        ORDER BY r.id ASC
        LIMIT ${limit} OFFSET ${offset}
    `);
    rows = (rowsRes?.rows ?? rowsRes ?? []).map((r: any) => ({
      id: r.id,
      memberId: r.member_id,
      memberName: r.member_name || null,
      memberEmail: r.member_email || null,
      memberPhone: r.member_phone || null,
      channel: r.channel,
      status: r.status,
      sentAt: r.sent_at,
      error: r.error,
      retryCount: r.retry_count,
      renderedSubject: r.rendered_subject,
      createdAt: r.created_at,
    }));

    const cntRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM communication_send_recipients r ${whereFragment}
    `);
    total = ((cntRes?.rows ?? cntRes)[0] ?? {}).n ?? 0;
  } catch (err: any) {
    return jsonError("select_recipients", err);
  }

  return new Response(
    JSON.stringify({ ok: true, recipients: rows, total }),
    { status: 200, headers: JSON_HEADER },
  );
}
