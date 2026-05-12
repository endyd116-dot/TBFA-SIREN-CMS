/**
 * 1회용 마이그레이션 — AI 비용 안전장치 Phase 1~4 + 기능별 집계
 *  - ai_agent_logs : 토큰·비용 컬럼 추가 (input_tokens, output_tokens, cost_usd, model)
 *  - ai_cost_summary : 일·월 비용 집계 캐시
 *      (period_type, period_key, feature_key) UNIQUE
 *      feature_key=NULL이면 전체 합계
 *  - ai_usage_logs : 모든 AI 호출 통합 로그 (기능별 집계 원천)
 *  - ai_feature_settings : 기능 메타·토글·기능별 월 한도 (15개 시드)
 *  - ai_rate_limit_log : 사용자별 호출 카운터 (Phase 3)
 *  - ai_prompt_cache : Gemini Context Caching id 보존 (Phase 4)
 *
 * GET            : 진단 (인증 불필요)
 * GET ?run=1     : 어드민 인증 후 실행 (멱등 — 여러 번 호출해도 안전)
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
        "ai_agent_logs.input_tokens / output_tokens / cost_usd / model (컬럼)",
        "ai_cost_summary (신규 테이블, feature_key 차원 포함)",
        "ai_usage_logs (신규 테이블 — 모든 AI 호출 통합 로그)",
        "ai_feature_settings (신규 테이블 — 15개 기능 토글·한도 시드)",
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

  /* 2) ai_cost_summary — 일·월 집계 (빠른 한도 체크용)
        feature_key가 NULL이면 '전체 합계' 의미.
        UNIQUE는 NULL을 같은 값으로 안 보므로 partial unique 2개로 분리. */
  await run("cost_summary", `
    CREATE TABLE IF NOT EXISTS ai_cost_summary (
      id BIGSERIAL PRIMARY KEY,
      period_type VARCHAR(10) NOT NULL,
      period_key VARCHAR(20) NOT NULL,
      feature_key VARCHAR(60),
      total_input_tokens BIGINT NOT NULL DEFAULT 0,
      total_output_tokens BIGINT NOT NULL DEFAULT 0,
      total_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
      call_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  /* 기존 (period_type, period_key) UNIQUE가 이미 있으면 제거 (feature_key 추가 후 무효) */
  await run("cost_summary_drop_old_unique", `
    ALTER TABLE ai_cost_summary DROP CONSTRAINT IF EXISTS ai_cost_summary_period_type_period_key_key
  `);
  /* 기존 행이 있는 경우 feature_key 컬럼 ALTER (이미 컬럼 존재 시 무해) */
  await run("cost_summary_add_feature_key", `
    ALTER TABLE ai_cost_summary ADD COLUMN IF NOT EXISTS feature_key VARCHAR(60)
  `);
  /* 전체 합계용 partial unique — feature_key IS NULL */
  await run("cost_summary_unique_total", `
    CREATE UNIQUE INDEX IF NOT EXISTS ai_cost_summary_total_uk
    ON ai_cost_summary(period_type, period_key)
    WHERE feature_key IS NULL
  `);
  /* 기능별 합계용 partial unique — feature_key IS NOT NULL */
  await run("cost_summary_unique_feature", `
    CREATE UNIQUE INDEX IF NOT EXISTS ai_cost_summary_feature_uk
    ON ai_cost_summary(period_type, period_key, feature_key)
    WHERE feature_key IS NOT NULL
  `);
  await run("cost_summary_idx", `
    CREATE INDEX IF NOT EXISTS ai_cost_summary_lookup_idx
    ON ai_cost_summary(period_type, period_key DESC, feature_key)
  `);

  /* 2-b) ai_usage_logs — 모든 Gemini 호출 통합 로그 (기능별 집계 원천) */
  await run("usage_logs", `
    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id BIGSERIAL PRIMARY KEY,
      feature_key VARCHAR(60) NOT NULL,
      model VARCHAR(60),
      admin_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      conversation_id BIGINT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      success BOOLEAN NOT NULL DEFAULT TRUE,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await run("usage_logs_feature_idx", `
    CREATE INDEX IF NOT EXISTS ai_usage_logs_feature_idx
    ON ai_usage_logs(feature_key, created_at DESC)
  `);
  await run("usage_logs_admin_idx", `
    CREATE INDEX IF NOT EXISTS ai_usage_logs_admin_idx
    ON ai_usage_logs(admin_id, created_at DESC)
  `);

  /* 2-c) ai_feature_settings — 기능 메타·토글·기능별 한도 */
  await run("feature_settings", `
    CREATE TABLE IF NOT EXISTS ai_feature_settings (
      feature_key VARCHAR(60) PRIMARY KEY,
      feature_name VARCHAR(120) NOT NULL,
      category VARCHAR(30) NOT NULL,
      description TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      monthly_budget_usd NUMERIC(10,2),
      sort_order INTEGER NOT NULL DEFAULT 100,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /* 15개 기능 시드 — INSERT ... ON CONFLICT DO NOTHING (멱등) */
  const seeds: Array<[string, string, string, string, number]> = [
    /* feature_key, name, category, description, sort */
    /* === 사용자 신청 자동 분석 (5) === */
    ["support_priority_analysis",   "지원 신청 우선순위 분석",     "user_request",   "유족 지원 신청서를 받을 때 긴급/일반/낮음 자동 분류", 110],
    ["incident_analysis",            "SIREN 사건 제보 AI 분석",     "user_request",   "사건 제보 본문에서 심각도·요약·대응 제안 자동 추출",  120],
    ["harassment_analysis",          "악성민원 AI 분석",            "user_request",   "악성민원 신고 분류·심각도 평가·법적 검토 자동",     130],
    ["legal_consultation_analysis",  "법률 상담 1차 자문",          "user_request",   "법률 상담 신청에서 카테고리·시급도·관련 법령 추출", 140],
    ["task_auto_summary",            "워크스페이스 작업 자동 요약", "user_request",   "워크스페이스 카드 생성 시 description 3줄 요약 자동", 150],
    ["task_completion_report",       "작업 완료 보고서 초안",       "user_request",   "워크스페이스 작업 'done' 이동 시 마크다운 보고서 초안", 160],

    /* === 운영자 즉시 호출 (6) === */
    ["support_reply_draft",          "AI 답변 초안 생성",           "admin_action",   "지원 신청·사건·악성민원·법률·게시판 답변 초안 자동 작성", 210],
    ["campaign_ai_copy",             "캠페인 카피 자동 생성",       "admin_action",   "캠페인 등록 시 제목·소개·본문 카피 AI 생성",          220],
    ["report_ai_summary",            "활동보고서 AI 요약",          "admin_action",   "기간별 활동보고서 생성 시 요약·인사이트 AI 작성",     230],
    ["churn_reengage_ai",            "이탈 후원자 재참여 메일",     "admin_action",   "후원자 재참여 캠페인 메일 본문 AI 생성",              240],
    ["expert_recommendation",        "전문가 추천 AI",              "admin_action",   "신청 내용에 맞는 전문가 추천 (수동 트리거)",          250],
    ["expert_match_generation",      "전문가 매칭 생성",            "admin_action",   "신청 기반 전문가 매칭 결과 생성",                     260],
    ["donor_data_extraction",        "잠재 후원자 데이터 추출",     "admin_action",   "외부 텍스트에서 잠재 후원자 정보 추출",               270],
    ["similar_cases",                "유사 사건 추천",              "admin_action",   "사건 본문을 받아 과거 유사 사건 자동 추천",           280],
    ["natural_search",               "자연어 검색 파싱",            "admin_action",   "한국어 검색 조건을 필터로 변환",                      290],

    /* === Cron 자동 실행 (4) === */
    ["task_daily_risk_evaluation",   "작업 리스크 일일 평가",       "cron_daily",     "매일 06:30 KST — 진행 중 작업 리스크 점수 갱신",      310],
    ["donor_churn_daily_evaluation", "후원자 이탈 예측 일일",       "cron_daily",     "매일 04:00 KST — 활성 후원자 전체 이탈 예측",         320],
    ["daily_briefing_generation",    "일일 브리핑 생성",            "cron_daily",     "매일 06:00 KST — 운영자별 일일 브리핑 AI 작성",       330],
    ["weekly_report_generation",     "주간 대표 보고서 생성",       "cron_daily",     "매주 월 06:00 KST — 전주 활동 요약·위험경보",         340],

    /* === AI 비서 채팅 (1) === */
    ["ai_agent_chat",                "AI 비서 채팅",                "agent_chat",     "관리자 CMS의 AI 비서 대화 (대화 1턴당 1~5회 호출)",   410],
  ];

  for (const [key, name, cat, desc, sort] of seeds) {
    await run(`seed_${key}`, `
      INSERT INTO ai_feature_settings (feature_key, feature_name, category, description, sort_order)
      VALUES ('${key}', '${name.replace(/'/g, "''")}', '${cat}', '${desc.replace(/'/g, "''")}', ${sort})
      ON CONFLICT (feature_key) DO NOTHING
    `);
  }

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
