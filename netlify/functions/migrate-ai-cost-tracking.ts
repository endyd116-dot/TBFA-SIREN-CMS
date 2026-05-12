/**
 * 1회용 마이그레이션 — AI 비용 안전장치 Phase 1~4
 *  - ai_agent_logs : 토큰·비용 컬럼 추가 (input_tokens, output_tokens, cost_usd, model)
 *  - ai_cost_summary : 일·월 비용 집계 캐시 (period_type/period_key UNIQUE)
 *  - ai_rate_limit_log : 사용자별 호출 카운터 (window_type/window_start)
 *  - ai_prompt_cache : Gemini Context Caching id 보존 (Phase 4)
 *
 * GET            : 진단 (인증 불필요)
 * GET ?run=1     : 어드민 인증 후 실행
 * 호출 성공 후 → 파일 삭제 + schema 정의 활성화
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-ai-cost-tracking" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);

  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnostic",
      adds: [
        "ai_agent_logs.input_tokens",
        "ai_agent_logs.output_tokens",
        "ai_agent_logs.cost_usd",
        "ai_agent_logs.model",
        "ai_cost_summary (신규 테이블)",
        "ai_rate_limit_log (신규 테이블)",
        "ai_prompt_cache (신규 테이블)",
      ],
      callExample: "GET /api/migrate-ai-cost-tracking?run=1 (어드민 로그인 필요)",
    }), { status: 200, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { step: string; result: string }[] = [];
  async function run(step: string, ddl: string) {
    try {
      await db.execute(sql.raw(ddl));
      results.push({ step, result: "ok" });
    } catch (e: any) {
      results.push({ step, result: String(e?.message).slice(0, 300) });
    }
  }

  /* 1) ai_agent_logs에 컬럼 추가 (이미 있어도 IF NOT EXISTS로 안전) */
  await run("logs_input_tokens",  "ALTER TABLE ai_agent_logs ADD COLUMN IF NOT EXISTS input_tokens INTEGER");
  await run("logs_output_tokens", "ALTER TABLE ai_agent_logs ADD COLUMN IF NOT EXISTS output_tokens INTEGER");
  await run("logs_cost_usd",      "ALTER TABLE ai_agent_logs ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10,6)");
  await run("logs_model",         "ALTER TABLE ai_agent_logs ADD COLUMN IF NOT EXISTS model VARCHAR(60)");

  /* 2) ai_cost_summary — 일·월 집계 (빠른 한도 체크용) */
  await run("cost_summary", `
    CREATE TABLE IF NOT EXISTS ai_cost_summary (
      id BIGSERIAL PRIMARY KEY,
      period_type VARCHAR(10) NOT NULL,
      period_key VARCHAR(20) NOT NULL,
      total_input_tokens BIGINT NOT NULL DEFAULT 0,
      total_output_tokens BIGINT NOT NULL DEFAULT 0,
      total_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
      call_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(period_type, period_key)
    )
  `);
  await run("cost_summary_idx", `
    CREATE INDEX IF NOT EXISTS ai_cost_summary_key_idx
    ON ai_cost_summary(period_type, period_key DESC)
  `);

  /* 3) ai_rate_limit_log — 분/시간/일 카운터 DB 백업 */
  await run("rate_limit_log", `
    CREATE TABLE IF NOT EXISTS ai_rate_limit_log (
      id BIGSERIAL PRIMARY KEY,
      admin_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      window_start TIMESTAMPTZ NOT NULL,
      window_type VARCHAR(10) NOT NULL,
      call_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(admin_id, window_type, window_start)
    )
  `);
  await run("rate_limit_idx", `
    CREATE INDEX IF NOT EXISTS ai_rate_limit_lookup_idx
    ON ai_rate_limit_log(admin_id, window_type, window_start DESC)
  `);

  /* 4) ai_prompt_cache — Gemini Context Caching id 보존 (Phase 4) */
  await run("prompt_cache", `
    CREATE TABLE IF NOT EXISTS ai_prompt_cache (
      id BIGSERIAL PRIMARY KEY,
      cache_key VARCHAR(120) NOT NULL,
      cache_name TEXT NOT NULL,
      model VARCHAR(60) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(cache_key)
    )
  `);
  await run("prompt_cache_idx", `
    CREATE INDEX IF NOT EXISTS ai_prompt_cache_expiry_idx
    ON ai_prompt_cache(expires_at DESC)
  `);

  return new Response(
    JSON.stringify({ ok: true, results }, null, 2),
    { status: 200, headers: JSON_HEADER }
  );
};
