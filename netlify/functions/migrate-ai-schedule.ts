/**
 * 1회용 마이그 — ai_scheduled_commands 테이블 생성 + 권한 시드
 *
 * GET            : 진단 모드 (인증 불필요)
 * GET ?run=1     : 어드민 인증 후 실행 (멱등)
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-ai-schedule" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

const SCHEDULE_TOOLS: Array<[string, boolean, string, string, string]> = [
  /* [name, isMutation, category, requiredRole, description] */
  ["schedule_command",        true,  "schedule", "super_admin", "AI 명령을 cron 일정으로 등록 — 지정 시간마다 자동 실행 (dry-run 우선)"],
  ["scheduled_commands_list", false, "schedule", "admin",       "등록된 AI 스케줄 명령 목록 조회"],
  ["schedule_cancel",         true,  "schedule", "super_admin", "스케줄 명령 비활성화 (dry-run 우선)"],
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);

  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnostic",
      steps: [
        "create_table_ai_scheduled_commands",
        "create_index_next_run_at",
        ...SCHEDULE_TOOLS.map(t => `seed_${t[0]}`),
      ],
      count: 2 + SCHEDULE_TOOLS.length,
    }), { status: 200, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { step: string; result: string }[] = [];

  // 1) 테이블 생성
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_scheduled_commands (
        id          BIGSERIAL PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        cron_expr   VARCHAR(50) NOT NULL,
        command     TEXT NOT NULL,
        admin_id    INTEGER REFERENCES members(id),
        is_active   BOOLEAN DEFAULT true,
        last_run_at TIMESTAMP,
        next_run_at TIMESTAMP,
        last_result TEXT,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      )
    `);
    results.push({ step: "create_table_ai_scheduled_commands", result: "ok" });
  } catch (e: any) {
    results.push({ step: "create_table_ai_scheduled_commands", result: String(e?.message).slice(0, 200) });
  }

  // 2) 인덱스 생성
  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ai_scheduled_commands_next_run
        ON ai_scheduled_commands(next_run_at) WHERE is_active = true
    `);
    results.push({ step: "create_index_next_run_at", result: "ok" });
  } catch (e: any) {
    results.push({ step: "create_index_next_run_at", result: String(e?.message).slice(0, 200) });
  }

  // 3) 권한 시드
  for (const [name, isMutation, category, requiredRole, description] of SCHEDULE_TOOLS) {
    try {
      await db.execute(sql`
        INSERT INTO ai_tool_permissions
          (tool_name, enabled, required_role, description, is_mutation, category)
        VALUES
          (${name}, TRUE, ${requiredRole}, ${description}, ${isMutation}, ${category})
        ON CONFLICT (tool_name) DO NOTHING
      `);
      results.push({ step: `seed_${name}`, result: "ok" });
    } catch (e: any) {
      results.push({ step: `seed_${name}`, result: String(e?.message).slice(0, 200) });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }, null, 2),
    { status: 200, headers: JSON_HEADER });
};
