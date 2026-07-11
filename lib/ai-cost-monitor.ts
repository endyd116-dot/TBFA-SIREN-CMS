/**
 * AI 비용 모니터 — Phase 1
 *
 * 책임:
 *   1) Gemini 응답의 usageMetadata에서 토큰 수 추출 → 비용 계산
 *   2) ai_agent_logs에 input/output/cost 컬럼 업데이트
 *   3) ai_cost_summary 일·월 누적 갱신 (UPSERT)
 *   4) 월 한도($100) 초과 시 차단 / 경고 임계($80) 응답
 *
 * 사용:
 *   await recordTokenUsage({ adminId, conversationId, model, inputTokens, outputTokens })
 *   const budget = await checkMonthlyBudget()    // { ok, used, limit, message }
 *
 * 환경변수:
 *   AI_MONTHLY_BUDGET_USD    — 월 한도 (기본 100)
 *   AI_WARN_THRESHOLD_USD    — 경고 임계 (기본 80)
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

/* =========================================================
   모델별 가격표 (USD per 1M tokens)
   출처: https://ai.google.dev/pricing (2026-05-13 기준 추정치)
   ※ 실제 운영 적용 시 Google AI 공식 가격표 재확인 필요
   ========================================================= */
interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cachedInputPerMTok?: number;   // Context Caching 사용 시
}

const PRICING: Record<string, ModelPricing> = {
  "gemini-3.1-flash-lite":         { inputPerMTok: 0.025, outputPerMTok: 0.10,  cachedInputPerMTok: 0.00625 },
  "gemini-3.1-flash-lite-preview": { inputPerMTok: 0.025, outputPerMTok: 0.10,  cachedInputPerMTok: 0.00625 },
  "gemini-3-flash":                { inputPerMTok: 0.075, outputPerMTok: 0.30,  cachedInputPerMTok: 0.01875 },
  "gemini-3-flash-preview":        { inputPerMTok: 0.075, outputPerMTok: 0.30,  cachedInputPerMTok: 0.01875 },
  "gemini-3.0-flash":              { inputPerMTok: 0.075, outputPerMTok: 0.30,  cachedInputPerMTok: 0.01875 },
  "gemini-2.5-flash":              { inputPerMTok: 0.075, outputPerMTok: 0.30,  cachedInputPerMTok: 0.01875 },
  "gemini-2.5-flash-lite":         { inputPerMTok: 0.025, outputPerMTok: 0.10,  cachedInputPerMTok: 0.00625 },
  /* Q3-049: 임베딩 모델 — output 없음(0). 미등록 시 __default(flash $0.075/$0.30)로 과대계상되던 문제 해소 */
  "gemini-embedding-001":          { inputPerMTok: 0.15,  outputPerMTok: 0 },
  "text-embedding-004":            { inputPerMTok: 0.025, outputPerMTok: 0 },
  /* fallback for unknown model — flash 가격으로 보수적 계산 */
  "__default":                     { inputPerMTok: 0.075, outputPerMTok: 0.30 },
};

export function getPricing(model: string): ModelPricing {
  return PRICING[model] || PRICING.__default;
}

export function calcCost(model: string, inputTokens: number, outputTokens: number, cachedTokens = 0): number {
  const p = getPricing(model);
  const inTok = Math.max(0, inputTokens - cachedTokens);
  const inputCost   = (inTok / 1_000_000) * p.inputPerMTok;
  const cachedCost  = (cachedTokens / 1_000_000) * (p.cachedInputPerMTok ?? p.inputPerMTok);
  const outputCost  = (outputTokens / 1_000_000) * p.outputPerMTok;
  return inputCost + cachedCost + outputCost;
}

/* =========================================================
   기간 키 (UTC 기준 — Netlify Function 환경 일관성)
   ========================================================= */
function dailyKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);          // '2026-05-13'
}
function monthlyKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);           // '2026-05'
}

/* =========================================================
   토큰 사용 기록 — Gemini 응답 직후 호출
   ========================================================= */
interface RecordArgs {
  adminId: number | null;
  conversationId: number | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  /** 최근 INSERT된 ai_agent_logs.id가 있으면 해당 행에 토큰 컬럼 채우기 */
  recentLogIds?: number[];
}

export async function recordTokenUsage(args: RecordArgs): Promise<{ cost: number }> {
  const { model, inputTokens, outputTokens, cachedTokens = 0 } = args;
  const cost = calcCost(model, inputTokens, outputTokens, cachedTokens);

  /* 1) ai_agent_logs에 토큰·비용 채우기 — recentLogIds 있으면 그것만, 없으면 마지막 행 */
  try {
    if (args.recentLogIds && args.recentLogIds.length > 0) {
      const ids = args.recentLogIds;
      /* 호출당 1행만 토큰 기록 (Gemini 응답은 호출 단위 — 여러 도구 호출이면 첫 행에만) */
      const targetId = ids[0];
      await db.execute(sql`
        UPDATE ai_agent_logs
           SET input_tokens = COALESCE(input_tokens, 0) + ${inputTokens},
               output_tokens = COALESCE(output_tokens, 0) + ${outputTokens},
               cost_usd = COALESCE(cost_usd, 0) + ${cost},
               model = ${model}
         WHERE id = ${targetId}
      `);
    }
  } catch (e) {
    console.warn("[ai-cost-monitor] logs UPDATE 실패", (e as any)?.message);
  }

  /* 2) ai_cost_summary 일·월 UPSERT */
  try {
    const dKey = dailyKey();
    const mKey = monthlyKey();
    await db.execute(sql`
      INSERT INTO ai_cost_summary
        (period_type, period_key, total_input_tokens, total_output_tokens, total_cost_usd, call_count, updated_at)
      VALUES ('daily', ${dKey}, ${inputTokens}, ${outputTokens}, ${cost}, 1, NOW())
      ON CONFLICT (period_type, period_key) DO UPDATE SET
        total_input_tokens = ai_cost_summary.total_input_tokens + EXCLUDED.total_input_tokens,
        total_output_tokens = ai_cost_summary.total_output_tokens + EXCLUDED.total_output_tokens,
        total_cost_usd = ai_cost_summary.total_cost_usd + EXCLUDED.total_cost_usd,
        call_count = ai_cost_summary.call_count + 1,
        updated_at = NOW()
    `);
    await db.execute(sql`
      INSERT INTO ai_cost_summary
        (period_type, period_key, total_input_tokens, total_output_tokens, total_cost_usd, call_count, updated_at)
      VALUES ('monthly', ${mKey}, ${inputTokens}, ${outputTokens}, ${cost}, 1, NOW())
      ON CONFLICT (period_type, period_key) DO UPDATE SET
        total_input_tokens = ai_cost_summary.total_input_tokens + EXCLUDED.total_input_tokens,
        total_output_tokens = ai_cost_summary.total_output_tokens + EXCLUDED.total_output_tokens,
        total_cost_usd = ai_cost_summary.total_cost_usd + EXCLUDED.total_cost_usd,
        call_count = ai_cost_summary.call_count + 1,
        updated_at = NOW()
    `);
  } catch (e) {
    console.warn("[ai-cost-monitor] summary UPSERT 실패", (e as any)?.message);
  }

  return { cost };
}

/* =========================================================
   월 한도 체크 — Gemini 호출 직전
   ========================================================= */
export interface BudgetCheck {
  ok: boolean;
  used: number;
  limit: number;
  warn: boolean;
  warnThreshold: number;
  message: string;
}

function num(v: string | undefined, defaultVal: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

export async function checkMonthlyBudget(): Promise<BudgetCheck> {
  const limit = num(process.env.AI_MONTHLY_BUDGET_USD, 100);
  const warnThreshold = num(process.env.AI_WARN_THRESHOLD_USD, 80);
  const mKey = monthlyKey();

  let used = 0;
  try {
    const r: any = await db.execute(sql`
      SELECT total_cost_usd::float AS cost
        FROM ai_cost_summary
       WHERE period_type = 'monthly' AND period_key = ${mKey} AND feature_key IS NULL
       LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    used = Number(row?.cost) || 0;
  } catch (e) {
    /* 테이블 없으면 0으로 통과 (마이그 전 안전망) */
    return { ok: true, used: 0, limit, warn: false, warnThreshold, message: "" };
  }

  if (used >= limit) {
    return {
      ok: false, used, limit, warn: true, warnThreshold,
      message: `월 AI 비용 한도($${limit.toFixed(2)})를 초과했습니다. (현재 $${used.toFixed(4)}) ` +
               `호출이 차단됩니다. 관리자가 한도(AI_MONTHLY_BUDGET_USD)를 상향 조정해야 합니다.`,
    };
  }
  if (used >= warnThreshold) {
    return {
      ok: true, used, limit, warn: true, warnThreshold,
      message: `AI 비용 경고: 이번 달 사용액 $${used.toFixed(4)} / $${limit.toFixed(2)} (${((used / limit) * 100).toFixed(1)}%)`,
    };
  }
  return { ok: true, used, limit, warn: false, warnThreshold, message: "" };
}

/* =========================================================
   요약 조회 — admin-ai-cost-stats에서 사용
   ========================================================= */
export interface CostStats {
  today: { cost: number; inputTokens: number; outputTokens: number; calls: number };
  month: { cost: number; inputTokens: number; outputTokens: number; calls: number };
  limit: number;
  warnThreshold: number;
  recentDays: Array<{ date: string; cost: number; calls: number }>;
}

export async function getCostStats(): Promise<CostStats> {
  const limit = num(process.env.AI_MONTHLY_BUDGET_USD, 100);
  const warnThreshold = num(process.env.AI_WARN_THRESHOLD_USD, 80);
  const dKey = dailyKey();
  const mKey = monthlyKey();

  async function fetchOne(type: string, key: string) {
    try {
      const r: any = await db.execute(sql`
        SELECT total_cost_usd::float AS cost,
               total_input_tokens::bigint AS input_tokens,
               total_output_tokens::bigint AS output_tokens,
               call_count AS calls
          FROM ai_cost_summary
         WHERE period_type = ${type} AND period_key = ${key} AND feature_key IS NULL
         LIMIT 1
      `);
      const row = (r?.rows ?? r ?? [])[0];
      return {
        cost: Number(row?.cost) || 0,
        inputTokens: Number(row?.input_tokens) || 0,
        outputTokens: Number(row?.output_tokens) || 0,
        calls: Number(row?.calls) || 0,
      };
    } catch {
      return { cost: 0, inputTokens: 0, outputTokens: 0, calls: 0 };
    }
  }

  const [today, month] = await Promise.all([fetchOne("daily", dKey), fetchOne("monthly", mKey)]);

  let recentDays: Array<{ date: string; cost: number; calls: number }> = [];
  try {
    const r: any = await db.execute(sql`
      SELECT period_key AS date,
             total_cost_usd::float AS cost,
             call_count AS calls
        FROM ai_cost_summary
       WHERE period_type = 'daily'
       ORDER BY period_key DESC
       LIMIT 14
    `);
    const rows = r?.rows ?? r ?? [];
    recentDays = rows.map((row: any) => ({
      date: String(row.date),
      cost: Number(row.cost) || 0,
      calls: Number(row.calls) || 0,
    }));
  } catch {
    recentDays = [];
  }

  return { today, month, limit, warnThreshold, recentDays };
}
