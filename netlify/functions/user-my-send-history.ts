// netlify/functions/user-my-send-history.ts
// Phase 10 R4 — 사용자: 본인 수신 이력 조회
//
// GET ?limit=20&offset=0&from=&to=
// 인증: 사용자 JWT (httpOnly 쿠키)

import { requireActiveUser } from "../../lib/auth";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/user-my-send-history" };

export default async function handler(req: Request) {
  const auth = await requireActiveUser(req);
  if (!auth.ok) return auth.res;
  const uid = auth.user.uid;

  const url = new URL(req.url);
  const limit  = Math.min(Number(url.searchParams.get("limit"))  || 20, 100);
  const offset = Number(url.searchParams.get("offset")) || 0;
  const from   = url.searchParams.get("from") || null;
  const to     = url.searchParams.get("to")   || null;

  try {
    const fromClause = from ? sql`AND r.created_at >= ${new Date(from)}` : sql``;
    const toClause   = to   ? sql`AND r.created_at <= ${new Date(to)}`   : sql``;

    const rowsRes: any = await db.execute(sql`
      SELECT r.id,
             j.name AS job_name,
             r.channel,
             r.status,
             r.sent_at,
             r.open_count,
             r.click_count,
             r.opened_at,
             r.clicked_at,
             r.created_at
        FROM communication_send_recipients r
        LEFT JOIN communication_send_jobs j ON j.id = r.job_id
       WHERE r.member_id = ${uid}
         AND r.status IN ('sent','failed')
         ${fromClause}
         ${toClause}
       ORDER BY r.created_at DESC
       LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = rowsRes?.rows ?? rowsRes ?? [];

    const totalRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n
        FROM communication_send_recipients r
       WHERE r.member_id = ${uid}
         AND r.status IN ('sent','failed')
         ${fromClause}
         ${toClause}
    `);
    const total = ((totalRes?.rows ?? totalRes)[0] ?? {}).n ?? 0;

    return new Response(
      JSON.stringify({ ok: true, rows, total }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "수신 이력 조회 실패",
        step: "select",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
