/**
 * GET /api/admin-ai-conversations-list
 * AI 에이전트 대화 이력 조회 (관리자가 자기 또는 전체 조회)
 *
 * Query:
 *   adminId? — 특정 관리자 (없으면 본인 + 전체 super_admin)
 *   limit (기본 50, 최대 100)
 *   offset
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-ai-conversations-list" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "GET만 허용" }),
      { status: 405, headers: JSON_HEADER });
  }
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0"), 0);
  const adminFilter = url.searchParams.get("adminId");

  const where = adminFilter
    ? sql`WHERE c.admin_id = ${Number(adminFilter)}`
    : sql``;

  try {
    const r: any = await db.execute(sql`
      SELECT c.id, c.admin_id, m.name AS admin_name, c.title,
             jsonb_array_length(c.messages) AS message_count,
             c.created_at, c.updated_at
        FROM ai_agent_conversations c
        LEFT JOIN members m ON m.id = c.admin_id
        ${where}
       ORDER BY c.updated_at DESC
       LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = r?.rows ?? r ?? [];

    const cntRes: any = await db.execute(adminFilter
      ? sql`SELECT COUNT(*)::int AS n FROM ai_agent_conversations WHERE admin_id = ${Number(adminFilter)}`
      : sql`SELECT COUNT(*)::int AS n FROM ai_agent_conversations`);
    const total = Number((cntRes?.rows ?? cntRes)[0]?.n) || 0;

    return new Response(JSON.stringify({ ok: true, total, rows }),
      { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "대화 이력 조회 실패",
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
};
