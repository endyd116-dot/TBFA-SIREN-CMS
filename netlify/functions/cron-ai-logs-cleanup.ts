/**
 * cron-ai-logs-cleanup.ts — AI 비용 로그 자동 청소
 *
 * 매일 KST 03:00 (UTC 18:00) 실행:
 *   1) ai_rate_limit_log: 30일 지난 행 삭제 (테이블 용량 관리)
 *   2) ai_usage_logs: 90일 지난 행 삭제 (운영 데이터 보존)
 *   3) ai_prompt_cache: 만료된 행 삭제 (expires_at < NOW())
 *
 * 동작 안 해도 운영에 즉시 영향 없음 — 단순 용량 관리
 */

import type { Config } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";

export default async (_req: Request) => {
  const results: Array<{ step: string; deleted?: number; error?: string }> = [];

  /* 1) Rate Limit 카운터 — 30일 지난 행 */
  try {
    const r: any = await db.execute(sql`
      DELETE FROM ai_rate_limit_log
       WHERE window_start < NOW() - INTERVAL '30 days'
    `);
    results.push({ step: "rate_limit_log_30d", deleted: r?.rowCount ?? r?.count ?? 0 });
  } catch (e: any) {
    results.push({ step: "rate_limit_log_30d", error: String(e?.message).slice(0, 200) });
  }

  /* 2) AI 호출 통합 로그 — 90일 지난 행 (월 한도 추적은 ai_cost_summary로 충분) */
  try {
    const r: any = await db.execute(sql`
      DELETE FROM ai_usage_logs
       WHERE created_at < NOW() - INTERVAL '90 days'
    `);
    results.push({ step: "usage_logs_90d", deleted: r?.rowCount ?? r?.count ?? 0 });
  } catch (e: any) {
    results.push({ step: "usage_logs_90d", error: String(e?.message).slice(0, 200) });
  }

  /* 3) 만료된 프롬프트 캐시 */
  try {
    const r: any = await db.execute(sql`
      DELETE FROM ai_prompt_cache WHERE expires_at < NOW()
    `);
    results.push({ step: "prompt_cache_expired", deleted: r?.rowCount ?? r?.count ?? 0 });
  } catch (e: any) {
    results.push({ step: "prompt_cache_expired", error: String(e?.message).slice(0, 200) });
  }

  console.info("[cron-ai-logs-cleanup]", JSON.stringify(results));
  return new Response(JSON.stringify({ ok: true, results }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json" } });
};

/* 매일 KST 03:00 (UTC 18:00) */
export const config: Config = { schedule: "0 18 * * *" };
