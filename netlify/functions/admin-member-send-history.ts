// netlify/functions/admin-member-send-history.ts
// Phase 10 R4 — 어드민: 특정 회원의 발송 수신 이력 조회
//
// GET ?memberId={id}&limit=50&offset=0&from=&to=

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-member-send-history" };

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const memberId = Number(url.searchParams.get("memberId"));
  if (!memberId || isNaN(memberId)) {
    return new Response(
      JSON.stringify({ ok: false, error: "회원 ID(memberId)가 필요합니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const limit  = Math.min(Number(url.searchParams.get("limit"))  || 50, 200);
  const offset = Number(url.searchParams.get("offset")) || 0;
  const from   = url.searchParams.get("from") || null;
  const to     = url.searchParams.get("to")   || null;

  try {
    /* 회원 존재 확인 */
    const memberRes: any = await db.execute(sql`
      SELECT id, name, email FROM members WHERE id = ${memberId} LIMIT 1
    `);
    const member = (memberRes?.rows ?? memberRes ?? [])[0];
    if (!member) {
      return new Response(
        JSON.stringify({ ok: false, error: "회원을 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    /* 수신 이력 조회 */
    const fromClause = from ? sql`AND r.created_at >= ${new Date(from)}` : sql``;
    const toClause   = to   ? sql`AND r.created_at <= ${new Date(to)}`   : sql``;

    const rowsRes: any = await db.execute(sql`
      SELECT r.id,
             r.job_id,
             j.name AS job_name,
             r.channel,
             r.status,
             r.sent_at,
             r.error,
             r.retry_count,
             r.open_count,
             r.click_count,
             r.opened_at,
             r.clicked_at,
             r.created_at
        FROM communication_send_recipients r
        LEFT JOIN communication_send_jobs j ON j.id = r.job_id
       WHERE r.member_id = ${memberId}
         ${fromClause}
         ${toClause}
       ORDER BY r.created_at DESC
       LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = rowsRes?.rows ?? rowsRes ?? [];

    const totalRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n
        FROM communication_send_recipients r
       WHERE r.member_id = ${memberId}
         ${fromClause}
         ${toClause}
    `);
    const total = ((totalRes?.rows ?? totalRes)[0] ?? {}).n ?? 0;

    return new Response(
      JSON.stringify({
        ok: true,
        member: { id: member.id, name: member.name, email: member.email },
        rows,
        total,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "발송 이력 조회 실패",
        step: "select",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
