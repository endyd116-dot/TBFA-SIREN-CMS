/**
 * 1회용 마이그레이션 — AI 에이전트용 테이블 2개 생성
 *  - ai_agent_conversations: 대화 세션 (관리자별)
 *  - ai_agent_logs: AI 호출·도구 사용·rollback 기록
 *
 * GET ?run=1 : 어드민 인증 후 실행
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-ai-agent" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic",
      tables: ["ai_agent_conversations", "ai_agent_logs"],
    }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { step: string; result: string }[] = [];
  async function run(step: string, ddl: string) {
    try {
      await db.execute(sql.raw(ddl));
      results.push({ step, result: "ok" });
    } catch (e: any) {
      results.push({ step, result: String(e?.message).slice(0, 200) });
    }
  }

  await run("conversations", `
    CREATE TABLE IF NOT EXISTS ai_agent_conversations (
      id BIGSERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      title VARCHAR(200),
      messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await run("conv_admin_idx", `
    CREATE INDEX IF NOT EXISTS ai_agent_conv_admin_idx
    ON ai_agent_conversations(admin_id, updated_at DESC)
  `);

  await run("logs", `
    CREATE TABLE IF NOT EXISTS ai_agent_logs (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT REFERENCES ai_agent_conversations(id) ON DELETE CASCADE,
      admin_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      tool_name VARCHAR(100),
      input_args JSONB,
      output JSONB,
      status VARCHAR(20),
      rollback_data JSONB,
      duration_ms INTEGER,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await run("logs_conv_idx", `
    CREATE INDEX IF NOT EXISTS ai_agent_logs_conv_idx
    ON ai_agent_logs(conversation_id, created_at DESC)
  `);
  await run("logs_admin_idx", `
    CREATE INDEX IF NOT EXISTS ai_agent_logs_admin_idx
    ON ai_agent_logs(admin_id, created_at DESC)
  `);

  return new Response(JSON.stringify({ ok: true, results }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
};
