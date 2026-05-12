/**
 * GET /api/admin-ai-conversation-detail?id=N
 * 단일 대화의 메시지 전체 + 도구 호출 로그
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-ai-conversation-detail" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") return new Response(JSON.stringify({ ok: false, error: "GET만" }),
    { status: 405, headers: JSON_HEADER });

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id") || 0);
  if (!id) return new Response(JSON.stringify({ ok: false, error: "id 필수" }),
    { status: 400, headers: JSON_HEADER });

  try {
    const cr: any = await db.execute(sql`
      SELECT c.id, c.admin_id, m.name AS admin_name, c.title, c.messages, c.created_at, c.updated_at
        FROM ai_agent_conversations c
        LEFT JOIN members m ON m.id = c.admin_id
       WHERE c.id = ${id} LIMIT 1
    `);
    const conv = (cr?.rows ?? cr ?? [])[0];
    if (!conv) return new Response(JSON.stringify({ ok: false, error: "대화 없음" }),
      { status: 404, headers: JSON_HEADER });

    const lr: any = await db.execute(sql`
      SELECT id, tool_name, input_args, output, status, duration_ms, error, created_at
        FROM ai_agent_logs
       WHERE conversation_id = ${id}
       ORDER BY created_at ASC LIMIT 200
    `);
    const logs = lr?.rows ?? lr ?? [];

    return new Response(JSON.stringify({ ok: true, conversation: conv, logs }),
      { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "조회 실패",
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
};
