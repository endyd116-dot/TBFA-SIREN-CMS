/**
 * AI 호출 Rate Limit — Phase 3
 *
 * 사용자별(adminId)로 분/시간/일 호출 횟수 제한.
 *
 * 한도 (환경변수로 override 가능):
 *   AI_RATE_LIMIT_PER_MINUTE  기본 10
 *   AI_RATE_LIMIT_PER_HOUR    기본 50
 *   AI_RATE_LIMIT_PER_DAY     기본 500
 *
 * 카운터:
 *   - 1차: in-memory (함수 인스턴스별) — 빠르고 무료
 *   - 2차(백업): ai_rate_limit_log 테이블 — 콜드 스타트 후에도 일 한도 유지
 *
 * 사용:
 *   const rl = await checkRateLimit(adminId);
 *   if (!rl.ok) return jsonError(429, rl.message);
 *
 * checkRateLimit 안에서 카운터 증가도 같이 처리(별도 record 호출 불필요).
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

const RATE_PER_MIN  = numEnv("AI_RATE_LIMIT_PER_MINUTE", 10);
const RATE_PER_HOUR = numEnv("AI_RATE_LIMIT_PER_HOUR",   50);
const RATE_PER_DAY  = numEnv("AI_RATE_LIMIT_PER_DAY",   500);

function numEnv(key: string, defaultVal: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

/* =========================================================
   메모리 카운터 — 사용자별 호출 시각 배열
   ========================================================= */
const buckets = new Map<string, number[]>();   // adminId(or 'anon') → 호출 timestamps (오름차순)

function pruneTimestamps(arr: number[], maxAgeMs: number): number[] {
  const cutoff = Date.now() - maxAgeMs;
  /* 효율 위해 in-place — 앞쪽 만료분 제거 */
  let i = 0;
  while (i < arr.length && arr[i] < cutoff) i++;
  if (i > 0) arr.splice(0, i);
  return arr;
}

export interface RateLimitResult {
  ok: boolean;
  message?: string;
  /** 남은 횟수 (가장 빠르게 차는 창 기준) */
  remaining?: number;
  /** 한도가 풀리는 시각 (ms epoch) */
  retryAtMs?: number;
}

/** 호출 직전에 한도 확인 + 통과 시 카운터 증가까지 한 번에 처리 */
export async function checkRateLimit(adminId: number | null | undefined): Promise<RateLimitResult> {
  const key = adminId == null ? "anon" : String(adminId);
  const now = Date.now();
  const arr = buckets.get(key) || [];
  pruneTimestamps(arr, 24 * 3600 * 1000);  /* 24h 초과분 정리 */

  /* 메모리 카운터 ─ 분/시간/일 */
  const lastMin   = arr.filter(t => t >= now - 60 * 1000).length;
  const lastHour  = arr.filter(t => t >= now - 3600 * 1000).length;
  const lastDay   = arr.length;

  /* DB 백업 (콜드 스타트 후에도 일 한도 유지) — 메모리가 낮을 때만 보조 확인 */
  let dbDayCount = 0;
  if (adminId != null && lastDay < RATE_PER_DAY) {
    try {
      const r: any = await db.execute(sql`
        SELECT COALESCE(SUM(call_count), 0)::int AS cnt
          FROM ai_rate_limit_log
         WHERE admin_id = ${adminId}
           AND window_type = 'day'
           AND window_start >= NOW() - INTERVAL '24 hours'
      `);
      dbDayCount = Number((r?.rows ?? r ?? [])[0]?.cnt) || 0;
    } catch { /* 테이블 없으면 무시 */ }
  }
  const effectiveDay = Math.max(lastDay, dbDayCount);

  if (lastMin >= RATE_PER_MIN) {
    const oldestInMin = arr.find(t => t >= now - 60 * 1000) ?? now;
    return rateBlock("분당", RATE_PER_MIN, oldestInMin + 60 * 1000);
  }
  if (lastHour >= RATE_PER_HOUR) {
    const oldestInHour = arr.find(t => t >= now - 3600 * 1000) ?? now;
    return rateBlock("시간당", RATE_PER_HOUR, oldestInHour + 3600 * 1000);
  }
  if (effectiveDay >= RATE_PER_DAY) {
    const oldestInDay = arr[0] ?? now;
    return rateBlock("일", RATE_PER_DAY, oldestInDay + 24 * 3600 * 1000);
  }

  /* 통과 — 카운터 증가 */
  arr.push(now);
  buckets.set(key, arr);

  /* DB 백업 INSERT (fire-and-forget) — 일 단위 윈도우 시작은 자정 KST 대신 단순 UTC */
  if (adminId != null) {
    void recordCallToDb(adminId, now);
  }

  return {
    ok: true,
    remaining: Math.min(
      RATE_PER_MIN - lastMin - 1,
      RATE_PER_HOUR - lastHour - 1,
      RATE_PER_DAY - effectiveDay - 1,
    ),
  };
}

function rateBlock(windowName: string, limit: number, retryAtMs: number): RateLimitResult {
  const secs = Math.max(1, Math.ceil((retryAtMs - Date.now()) / 1000));
  const friendly = secs >= 3600
    ? `${Math.ceil(secs / 3600)}시간`
    : secs >= 60
      ? `${Math.ceil(secs / 60)}분`
      : `${secs}초`;
  return {
    ok: false,
    retryAtMs,
    message: `AI 호출이 너무 잦습니다. ${windowName} 한도 ${limit}회를 초과했습니다. 약 ${friendly} 후 다시 시도해주세요.`,
  };
}

async function recordCallToDb(adminId: number, ts: number): Promise<void> {
  /* 분/시간/일 각각 window_start를 잘라서 UPSERT (call_count +1) */
  const minStart = new Date(Math.floor(ts / 60000) * 60000);
  const hourStart = new Date(Math.floor(ts / 3600000) * 3600000);
  const dayStart  = new Date(Math.floor(ts / 86400000) * 86400000);

  async function upsert(windowType: string, start: Date) {
    try {
      await db.execute(sql`
        INSERT INTO ai_rate_limit_log (admin_id, window_type, window_start, call_count)
        VALUES (${adminId}, ${windowType}, ${start}, 1)
        ON CONFLICT (admin_id, window_type, window_start) DO UPDATE SET
          call_count = ai_rate_limit_log.call_count + 1
      `);
    } catch { /* 테이블 없거나 충돌해도 무시 */ }
  }

  await upsert("minute", minStart);
  await upsert("hour",   hourStart);
  await upsert("day",    dayStart);
}

/* 진단·테스트용 — 메모리 카운터 리셋 */
export function resetRateLimitMemory(): void {
  buckets.clear();
}

/* 어드민 화면용 — 현재 사용자의 분/시간/일 카운트 조회 */
export async function getRateLimitStats(adminId: number | null | undefined) {
  const key = adminId == null ? "anon" : String(adminId);
  const now = Date.now();
  const arr = buckets.get(key) || [];
  return {
    perMinute: { used: arr.filter(t => t >= now - 60_000).length,      limit: RATE_PER_MIN },
    perHour:   { used: arr.filter(t => t >= now - 3_600_000).length,   limit: RATE_PER_HOUR },
    perDay:    { used: arr.length,                                      limit: RATE_PER_DAY },
  };
}
