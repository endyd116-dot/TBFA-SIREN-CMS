/**
 * AI 기능 관리 — 기능별 토글·한도·사용량 헬퍼
 *
 * 책임:
 *   1) FEATURE_REGISTRY: 시스템에 등록된 모든 AI 기능 메타 (DB 시드 동기)
 *   2) isFeatureEnabled(key): 어드민이 끈 기능인지 / 기능별 월 한도 초과인지 확인
 *   3) recordFeatureUsage(args): 통합 로그 + 일·월 집계 (전체 + 기능별) UPSERT
 *   4) getFeatureStats(): 어드민 화면용 — 기능별 사용량 + 토글 상태
 *
 * 30초 메모리 캐시로 isFeatureEnabled 부하 최소화 (DB 쿼리 회피)
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { calcCost, checkMonthlyBudget } from "./ai-cost-monitor";

/* =========================================================
   기능 카탈로그 — 마이그 시드와 1:1 매칭
   ========================================================= */
export type FeatureCategory = "user_request" | "admin_action" | "cron_daily" | "agent_chat";

export interface FeatureMeta {
  key: string;
  name: string;
  category: FeatureCategory;
  description: string;
  sortOrder: number;
}

export const FEATURE_REGISTRY: FeatureMeta[] = [
  /* === 사용자 신청 자동 분석 (5) === */
  { key: "support_priority_analysis",   name: "지원 신청 우선순위 분석",   category: "user_request",  description: "유족 지원 신청서를 받을 때 긴급/일반/낮음 자동 분류",   sortOrder: 110 },
  { key: "incident_analysis",            name: "SIREN 사건 제보 AI 분석",   category: "user_request",  description: "사건 제보 본문에서 심각도·요약·대응 제안 자동 추출",    sortOrder: 120 },
  { key: "harassment_analysis",          name: "악성민원 AI 분석",          category: "user_request",  description: "악성민원 신고 분류·심각도 평가·법적 검토 자동",         sortOrder: 130 },
  { key: "legal_consultation_analysis",  name: "법률 상담 1차 자문",        category: "user_request",  description: "법률 상담 신청에서 카테고리·시급도·관련 법령 추출",     sortOrder: 140 },
  { key: "task_auto_summary",            name: "워크스페이스 작업 자동 요약", category: "user_request",  description: "워크스페이스 카드 생성 시 description 3줄 요약 자동",   sortOrder: 150 },
  { key: "task_completion_report",       name: "작업 완료 보고서 초안",     category: "user_request",  description: "워크스페이스 작업 'done' 이동 시 마크다운 보고서 초안",  sortOrder: 160 },

  /* === 운영자 즉시 호출 (6) === */
  { key: "support_reply_draft",          name: "AI 답변 초안 생성",         category: "admin_action",  description: "지원 신청·사건·악성민원·법률·게시판 답변 초안 자동 작성", sortOrder: 210 },
  { key: "campaign_ai_copy",             name: "캠페인 카피 자동 생성",     category: "admin_action",  description: "캠페인 등록 시 제목·소개·본문 카피 AI 생성",            sortOrder: 220 },
  { key: "report_ai_summary",            name: "활동보고서 AI 요약",        category: "admin_action",  description: "기간별 활동보고서 생성 시 요약·인사이트 AI 작성",       sortOrder: 230 },
  { key: "churn_reengage_ai",            name: "이탈 후원자 재참여 메일",   category: "admin_action",  description: "후원자 재참여 캠페인 메일 본문 AI 생성",                 sortOrder: 240 },
  { key: "expert_recommendation",        name: "전문가 추천 AI",            category: "admin_action",  description: "신청 내용에 맞는 전문가 추천 (수동 트리거)",             sortOrder: 250 },
  { key: "expert_match_generation",      name: "전문가 매칭 생성",          category: "admin_action",  description: "신청 기반 전문가 매칭 결과 생성",                        sortOrder: 260 },
  { key: "donor_data_extraction",        name: "잠재 후원자 데이터 추출",   category: "admin_action",  description: "외부 텍스트에서 잠재 후원자 정보 추출",                  sortOrder: 270 },
  { key: "similar_cases",                name: "유사 사건 추천",            category: "admin_action",  description: "사건 본문을 받아 과거 유사 사건 자동 추천",              sortOrder: 280 },
  { key: "natural_search",               name: "자연어 검색 파싱",          category: "admin_action",  description: "관리자가 한국어로 입력한 검색 조건을 필터로 변환",       sortOrder: 290 },
  { key: "payroll_ai_summary",           name: "급여 집계 AI 분석",         category: "admin_action",  description: "월별 급여 명세 이상치·요약·점검을 AI가 분석 (수동 트리거)", sortOrder: 295 },
  { key: "milestone_matrix_mapping",     name: "마일스톤 매트릭스 AI 매핑", category: "admin_action",  description: "분기 성과 기준표(매트릭스) 텍스트에서 마일스톤 정의 추출·기존 충돌 판정", sortOrder: 296 },
  { key: "org_news_analysis",            name: "뉴스·여론 동향 분석",        category: "cron_daily",    description: "네이버 검색 수집 기사를 AI로 분석해 동향·감성·키워드 추출", sortOrder: 297 },
  { key: "memorial_story_detail",        name: "유가족이야기 상세 초안",      category: "admin_action",  description: "유튜브 영상 정보·운영자 메모로 추모 상세페이지 초안 생성",  sortOrder: 298 },

  /* === Cron 자동 실행 (4) === */
  { key: "task_daily_risk_evaluation",   name: "작업 리스크 일일 평가",     category: "cron_daily",    description: "매일 06:30 KST — 진행 중 작업 리스크 점수 갱신",        sortOrder: 310 },
  { key: "donor_churn_daily_evaluation", name: "후원자 이탈 예측 일일",     category: "cron_daily",    description: "매일 04:00 KST — 활성 후원자 전체 이탈 예측",           sortOrder: 320 },
  { key: "daily_briefing_generation",    name: "일일 브리핑 생성",          category: "cron_daily",    description: "매일 06:00 KST — 운영자별 일일 브리핑 AI 작성",         sortOrder: 330 },
  { key: "weekly_report_generation",     name: "주간 대표 보고서 생성",     category: "cron_daily",    description: "매주 월 06:00 KST — 전주 활동 요약·위험경보 보고서",    sortOrder: 340 },

  /* === AI 비서 채팅 (1) === */
  { key: "ai_agent_chat",                name: "AI 비서 채팅",              category: "agent_chat",    description: "관리자 CMS의 AI 비서 대화 (1턴당 1~5회 호출)",          sortOrder: 410 },

  /* === RAG 검색 인프라 (1) === */
  { key: "ai_rag_search",                name: "RAG 지식 의미 검색",        category: "agent_chat",    description: "AI 비서 질문 시 Q&A·메뉴얼 의미 검색 top-K 주입 (featureKey 토글)",  sortOrder: 420 },
];

const FEATURE_KEYS = new Set(FEATURE_REGISTRY.map(f => f.key));

export function isKnownFeature(key: string): boolean {
  return FEATURE_KEYS.has(key);
}

export function getFeatureMeta(key: string): FeatureMeta | undefined {
  return FEATURE_REGISTRY.find(f => f.key === key);
}

/* =========================================================
   기능 활성화/한도 확인 — 30초 메모리 캐시
   ========================================================= */
interface FeatureState {
  enabled: boolean;
  monthlyBudgetUsd: number | null;
}
const stateCache = new Map<string, { state: FeatureState; expiresAt: number }>();
const STATE_TTL_MS = 30_000;

async function loadFeatureState(key: string): Promise<FeatureState> {
  /* 캐시 hit */
  const cached = stateCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.state;

  let state: FeatureState = { enabled: true, monthlyBudgetUsd: null };
  try {
    const r: any = await db.execute(sql`
      SELECT enabled, monthly_budget_usd::float AS budget
        FROM ai_feature_settings
       WHERE feature_key = ${key}
       LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (row) {
      state = {
        enabled: row.enabled !== false,
        monthlyBudgetUsd: row.budget != null ? Number(row.budget) : null,
      };
    }
  } catch {
    /* 테이블 없으면 마이그 전 — 기본 enabled */
  }

  stateCache.set(key, { state, expiresAt: now + STATE_TTL_MS });
  return state;
}

/** 캐시 무효화 — 토글·한도 변경 시 호출 */
export function invalidateFeatureCache(key?: string) {
  if (key) stateCache.delete(key);
  else stateCache.clear();
}

export interface FeatureCheck {
  ok: boolean;
  enabled: boolean;
  reason?: "disabled" | "feature_budget_exceeded" | "monthly_budget_exceeded" | "surge_cooldown";
  message?: string;
  used?: number;
  limit?: number;
}

/* === 분 단위 이상 패턴 — 최근 5분 비용 급증 시 5분 cooldown === */
const SURGE_THRESHOLD_USD = Number(process.env.AI_SURGE_THRESHOLD_USD || "1.00");
const SURGE_WINDOW_MIN = 5;
const SURGE_COOLDOWN_MS = 5 * 60 * 1000;
let surgeCooldownUntil = 0;

function nowMs() { return Date.now(); }

/** 호출 직후 fire-and-forget — 5분 합계 임계 초과 시 cooldown 발동 */
export async function checkAndSetSurge(): Promise<void> {
  /* cooldown 중이면 추가 체크 안 함 (낭비 X) */
  if (surgeCooldownUntil > nowMs()) return;
  try {
    const r: any = await db.execute(sql`
      SELECT COALESCE(SUM(cost_usd::float), 0) AS total
        FROM ai_usage_logs
       WHERE created_at > NOW() - INTERVAL '${sql.raw(String(SURGE_WINDOW_MIN))} minutes'
    `);
    const total = Number((r?.rows ?? r ?? [])[0]?.total) || 0;
    if (total > SURGE_THRESHOLD_USD) {
      surgeCooldownUntil = nowMs() + SURGE_COOLDOWN_MS;
      console.warn(`[ai-feature] 비용 급증 감지: 최근 ${SURGE_WINDOW_MIN}분 누계 $${total.toFixed(4)} > 임계 $${SURGE_THRESHOLD_USD}. ${SURGE_COOLDOWN_MS / 1000}초 cooldown 시작.`);
    }
  } catch { /* SUM 실패는 무시 */ }
}

/** 호출 직전 — cooldown 중이면 차단 */
function checkSurgeCooldown(): { blocked: boolean; secondsRemaining: number; message: string } {
  const remain = Math.max(0, surgeCooldownUntil - nowMs());
  if (remain > 0) {
    const secs = Math.ceil(remain / 1000);
    return {
      blocked: true,
      secondsRemaining: secs,
      message: `최근 ${SURGE_WINDOW_MIN}분 AI 비용이 급증해 일시 차단 중입니다. ${secs}초 후 다시 시도해주세요.`,
    };
  }
  return { blocked: false, secondsRemaining: 0, message: "" };
}

/** 호출 직전 체크 — 비활성·기능별 한도·전체 월 한도 + 분 단위 cooldown */
export async function checkFeatureBeforeCall(featureKey: string): Promise<FeatureCheck> {
  /* 0) 분 단위 비용 급증 cooldown */
  const surge = checkSurgeCooldown();
  if (surge.blocked) {
    return { ok: false, enabled: true, reason: "surge_cooldown", message: surge.message };
  }

  /* 1) 토글 + 기능별 한도 */
  const state = await loadFeatureState(featureKey);
  if (!state.enabled) {
    return {
      ok: false, enabled: false, reason: "disabled",
      message: "관리자가 이 AI 기능을 비활성화했습니다.",
    };
  }

  /* 2) 기능별 월 한도 */
  if (state.monthlyBudgetUsd != null && state.monthlyBudgetUsd > 0) {
    const used = await getFeatureMonthlyCost(featureKey);
    if (used >= state.monthlyBudgetUsd) {
      return {
        ok: false, enabled: true, reason: "feature_budget_exceeded",
        message: `'${getFeatureMeta(featureKey)?.name || featureKey}' 기능의 월 한도($${state.monthlyBudgetUsd.toFixed(2)})를 초과했습니다.`,
        used, limit: state.monthlyBudgetUsd,
      };
    }
  }

  /* 3) 전체 월 한도 (Phase 1 기존 로직 재사용) */
  const overall = await checkMonthlyBudget();
  if (!overall.ok) {
    return {
      ok: false, enabled: true, reason: "monthly_budget_exceeded",
      message: overall.message, used: overall.used, limit: overall.limit,
    };
  }

  return { ok: true, enabled: true };
}

async function getFeatureMonthlyCost(featureKey: string): Promise<number> {
  const mKey = monthlyKey();
  try {
    const r: any = await db.execute(sql`
      SELECT total_cost_usd::float AS cost
        FROM ai_cost_summary
       WHERE period_type = 'monthly' AND period_key = ${mKey} AND feature_key = ${featureKey}
       LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    return Number(row?.cost) || 0;
  } catch {
    return 0;
  }
}

/* =========================================================
   사용량 기록 — Gemini 응답 직후
   ========================================================= */
function dailyKey(d = new Date()): string { return d.toISOString().slice(0, 10); }
function monthlyKey(d = new Date()): string { return d.toISOString().slice(0, 7); }

export interface RecordFeatureUsageArgs {
  featureKey: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  adminId?: number | null;
  conversationId?: number | null;
  durationMs?: number;
  success?: boolean;
  error?: string | null;
}

export async function recordFeatureUsage(args: RecordFeatureUsageArgs): Promise<{ cost: number }> {
  const {
    featureKey, model,
    inputTokens, outputTokens, cachedTokens = 0,
    adminId = null, conversationId = null,
    durationMs = null, success = true, error = null,
  } = args;
  const cost = calcCost(model, inputTokens, outputTokens, cachedTokens);

  /* 1) ai_usage_logs INSERT */
  try {
    await db.execute(sql`
      INSERT INTO ai_usage_logs
        (feature_key, model, admin_id, conversation_id,
         input_tokens, output_tokens, cached_tokens, cost_usd,
         duration_ms, success, error)
      VALUES
        (${featureKey}, ${model}, ${adminId}, ${conversationId},
         ${inputTokens}, ${outputTokens}, ${cachedTokens}, ${cost},
         ${durationMs}, ${success}, ${error})
    `);
  } catch (e) {
    console.warn("[ai-feature] usage_logs INSERT 실패", (e as any)?.message);
  }

  /* 2) ai_cost_summary UPSERT — 전체 합계 (feature_key NULL) + 기능별 (feature_key) 각각 일·월 */
  const dKey = dailyKey();
  const mKey = monthlyKey();
  await upsertSummary("daily", dKey, null, inputTokens, outputTokens, cost);
  await upsertSummary("daily", dKey, featureKey, inputTokens, outputTokens, cost);
  await upsertSummary("monthly", mKey, null, inputTokens, outputTokens, cost);
  await upsertSummary("monthly", mKey, featureKey, inputTokens, outputTokens, cost);

  /* 3) 비용 급증 감지 (fire-and-forget) */
  void checkAndSetSurge();

  return { cost };
}

async function upsertSummary(
  periodType: "daily" | "monthly",
  periodKey: string,
  featureKey: string | null,
  inTok: number,
  outTok: number,
  cost: number,
) {
  try {
    if (featureKey === null) {
      /* 전체 합계 — partial unique (period_type, period_key) WHERE feature_key IS NULL */
      await db.execute(sql`
        INSERT INTO ai_cost_summary
          (period_type, period_key, feature_key,
           total_input_tokens, total_output_tokens, total_cost_usd, call_count, updated_at)
        VALUES (${periodType}, ${periodKey}, NULL, ${inTok}, ${outTok}, ${cost}, 1, NOW())
        ON CONFLICT (period_type, period_key) WHERE feature_key IS NULL DO UPDATE SET
          total_input_tokens = ai_cost_summary.total_input_tokens + EXCLUDED.total_input_tokens,
          total_output_tokens = ai_cost_summary.total_output_tokens + EXCLUDED.total_output_tokens,
          total_cost_usd = ai_cost_summary.total_cost_usd + EXCLUDED.total_cost_usd,
          call_count = ai_cost_summary.call_count + 1,
          updated_at = NOW()
      `);
    } else {
      await db.execute(sql`
        INSERT INTO ai_cost_summary
          (period_type, period_key, feature_key,
           total_input_tokens, total_output_tokens, total_cost_usd, call_count, updated_at)
        VALUES (${periodType}, ${periodKey}, ${featureKey}, ${inTok}, ${outTok}, ${cost}, 1, NOW())
        ON CONFLICT (period_type, period_key, feature_key) WHERE feature_key IS NOT NULL DO UPDATE SET
          total_input_tokens = ai_cost_summary.total_input_tokens + EXCLUDED.total_input_tokens,
          total_output_tokens = ai_cost_summary.total_output_tokens + EXCLUDED.total_output_tokens,
          total_cost_usd = ai_cost_summary.total_cost_usd + EXCLUDED.total_cost_usd,
          call_count = ai_cost_summary.call_count + 1,
          updated_at = NOW()
      `);
    }
  } catch (e) {
    console.warn(`[ai-feature] summary UPSERT 실패 (${periodType}/${periodKey}/${featureKey})`, (e as any)?.message);
  }
}

/* =========================================================
   어드민 화면용 — 기능별 사용량 + 토글 상태
   ========================================================= */
export interface FeatureRow {
  key: string;
  name: string;
  category: FeatureCategory;
  description: string;
  enabled: boolean;
  monthlyBudgetUsd: number | null;
  todayCost: number;
  todayCalls: number;
  monthCost: number;
  monthCalls: number;
  monthInputTokens: number;
  monthOutputTokens: number;
  sortOrder: number;
}

export async function getFeatureStats(): Promise<FeatureRow[]> {
  const dKey = dailyKey();
  const mKey = monthlyKey();

  /* DB의 settings (마이그 후) — 없는 키는 메모리 카탈로그로 폴백 */
  let dbRows: any[] = [];
  try {
    const r: any = await db.execute(sql`
      SELECT feature_key, feature_name, category, description, enabled,
             monthly_budget_usd::float AS budget, sort_order
        FROM ai_feature_settings
       ORDER BY sort_order, feature_key
    `);
    dbRows = r?.rows ?? r ?? [];
  } catch { /* 마이그 전 — 빈 배열 */ }

  /* 키별 settings 맵 */
  const settingsMap = new Map<string, any>();
  for (const row of dbRows) settingsMap.set(String(row.feature_key), row);

  /* 키별 today / month 집계 — 한 번에 가져와서 메모리 분배 */
  const aggMap = new Map<string, { today?: any; month?: any }>();
  try {
    const r: any = await db.execute(sql`
      SELECT period_type, feature_key,
             total_input_tokens::bigint AS in_tok,
             total_output_tokens::bigint AS out_tok,
             total_cost_usd::float AS cost,
             call_count AS calls
        FROM ai_cost_summary
       WHERE feature_key IS NOT NULL
         AND ((period_type = 'daily' AND period_key = ${dKey})
              OR (period_type = 'monthly' AND period_key = ${mKey}))
    `);
    const rows = r?.rows ?? r ?? [];
    for (const row of rows) {
      const key = String(row.feature_key);
      if (!aggMap.has(key)) aggMap.set(key, {});
      const entry = aggMap.get(key)!;
      if (row.period_type === "daily") entry.today = row;
      else entry.month = row;
    }
  } catch { /* 빈 결과로 폴백 */ }

  /* 카탈로그 기준으로 행 합성 (시드와 동기화된 메모리 카탈로그 우선) */
  const result: FeatureRow[] = FEATURE_REGISTRY.map(meta => {
    const setting = settingsMap.get(meta.key);
    const agg = aggMap.get(meta.key) || {};
    return {
      key: meta.key,
      name: setting?.feature_name || meta.name,
      category: (setting?.category as FeatureCategory) || meta.category,
      description: setting?.description || meta.description,
      enabled: setting ? setting.enabled !== false : true,
      monthlyBudgetUsd: setting?.budget != null ? Number(setting.budget) : null,
      todayCost: Number(agg.today?.cost) || 0,
      todayCalls: Number(agg.today?.calls) || 0,
      monthCost: Number(agg.month?.cost) || 0,
      monthCalls: Number(agg.month?.calls) || 0,
      monthInputTokens: Number(agg.month?.in_tok) || 0,
      monthOutputTokens: Number(agg.month?.out_tok) || 0,
      sortOrder: setting?.sort_order ?? meta.sortOrder,
    };
  });

  /* DB에만 있고 카탈로그에는 없는 추가 기능도 표시 (확장성) */
  for (const row of dbRows) {
    const key = String(row.feature_key);
    if (FEATURE_KEYS.has(key)) continue;
    const agg = aggMap.get(key) || {};
    result.push({
      key,
      name: row.feature_name || key,
      category: row.category || "user_request",
      description: row.description || "",
      enabled: row.enabled !== false,
      monthlyBudgetUsd: row.budget != null ? Number(row.budget) : null,
      todayCost: Number(agg.today?.cost) || 0,
      todayCalls: Number(agg.today?.calls) || 0,
      monthCost: Number(agg.month?.cost) || 0,
      monthCalls: Number(agg.month?.calls) || 0,
      monthInputTokens: Number(agg.month?.in_tok) || 0,
      monthOutputTokens: Number(agg.month?.out_tok) || 0,
      sortOrder: Number(row.sort_order) || 900,
    });
  }

  result.sort((a, b) => a.sortOrder - b.sortOrder);
  return result;
}
