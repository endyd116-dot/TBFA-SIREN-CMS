/**
 * GET /api/admin-ai-logs-list
 * AI 도구 호출 로그 — 어떤 도구 몇 번, 성공/실패, 평균 시간
 *
 * Query: limit, offset, toolName?, status?, adminId?
 * 또는 ?stats=1 → 도구별 집계
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-ai-logs-list" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") return new Response(JSON.stringify({ ok: false, error: "GET만" }),
    { status: 405, headers: JSON_HEADER });

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const wantStats = url.searchParams.get("stats") === "1";

  try {
    if (wantStats) {
      /* 도구별 집계 */
      const r: any = await db.execute(sql`
        SELECT tool_name,
               COUNT(*)::int AS total_count,
               COUNT(*) FILTER (WHERE status = 'ok')::int AS ok_count,
               COUNT(*) FILTER (WHERE status = 'error')::int AS error_count,
               AVG(duration_ms)::int AS avg_duration_ms,
               MAX(created_at) AS last_called_at
          FROM ai_agent_logs
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY tool_name
          ORDER BY total_count DESC
      `);
      return new Response(JSON.stringify({ ok: true, stats: r?.rows ?? r ?? [] }),
        { status: 200, headers: JSON_HEADER });
    }

    /* 일반 로그 */
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0"), 0);
    const toolName = url.searchParams.get("toolName");
    const status = url.searchParams.get("status");
    const adminId = url.searchParams.get("adminId");

    const conds: any[] = [];
    if (toolName) conds.push(sql`l.tool_name = ${toolName}`);
    if (status) conds.push(sql`l.status = ${status}`);
    if (adminId) conds.push(sql`l.admin_id = ${Number(adminId)}`);
    const where = conds.length > 0
      ? sql`WHERE ${conds.reduce((a, b, i) => i === 0 ? b : sql`${a} AND ${b}`)}`
      : sql``;

    const r: any = await db.execute(sql`
      SELECT l.id, l.conversation_id, l.admin_id, m.name AS admin_name,
             l.tool_name, l.input_args, l.status, l.duration_ms, l.error, l.created_at
        FROM ai_agent_logs l
        LEFT JOIN members m ON m.id = l.admin_id
        ${where}
       ORDER BY l.created_at DESC
       LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = r?.rows ?? r ?? [];

    const cntRes: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM ai_agent_logs ${where}`);
    const total = Number((cntRes?.rows ?? cntRes)[0]?.n) || 0;

    return new Response(JSON.stringify({ ok: true, total, rows }),
      { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "로그 조회 실패",
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
};
