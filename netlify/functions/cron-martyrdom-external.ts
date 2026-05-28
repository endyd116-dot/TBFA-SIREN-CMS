/**
 * cron-martyrdom-external — R43 외부 자료 2주 자동 수집
 *
 * 매 2주 수요일 KST 03:00 (UTC 화요일 18:00) — netlify.toml 등록.
 * 동작:
 *   1) ai_feature_settings.martyrdom_ai_external.enabled 확인 — false면 즉시 종료
 *   2) martyrdom_external_settings.default_queries 로드
 *   3) admin-martyrdom-external-search-background에 위임 (queries × ['gemini','naver'])
 *   4) last_cron_at 갱신
 *
 * Netlify scheduled function — config.path 안 붙임, schedule만 인라인 + toml 이중 등록.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = {
  /* 표준 cron은 격주 직접 지원 X — 매주 화요일 18:00 UTC(KST 수요일 03:00)로 등록하고
     함수 안에서 last_cron_at 기준 "최소 13일 이상 경과" 게이트로 격주 효과 (운영 시 미세 조정 가능). */
  schedule: "0 18 * * 2",
};

const FEATURE_KEY = "martyrdom_ai_external";

export default async (_req: Request, _ctx: Context) => {
  const startMs = Date.now();
  console.info("[cron-martyrdom-external] 시작", new Date().toISOString());

  /* 1) 토글 확인 */
  let enabled = true;
  try {
    const r: any = await db.execute(sql`
      SELECT enabled FROM ai_feature_settings WHERE feature_key = ${FEATURE_KEY} LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (row && row.enabled === false) enabled = false;
  } catch (e: any) {
    console.warn(`[cron-martyrdom-external] 토글 조회 실패 — 활성으로 간주: ${e?.message}`);
  }
  if (!enabled) {
    console.info("[cron-martyrdom-external] 비활성(martyrdom_ai_external OFF) — 종료");
    return new Response("disabled", { status: 200 });
  }

  /* 2) 격주 게이트 + 기본 검색어 로드 */
  let queries: string[] = [];
  let lastCronAt: Date | null = null;
  try {
    const r: any = await db.execute(sql`
      SELECT default_queries, last_cron_at FROM martyrdom_external_settings ORDER BY id ASC LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (Array.isArray(row?.default_queries)) queries = (row.default_queries as string[]).filter(s => s && String(s).trim());
    if (row?.last_cron_at) { try { lastCronAt = new Date(row.last_cron_at); } catch { /* ignore */ } }
  } catch (e: any) {
    console.warn(`[cron-martyrdom-external] settings 조회 실패: ${e?.message}`);
  }
  if (queries.length === 0) {
    console.info("[cron-martyrdom-external] 기본 검색어 없음 — 종료 (어드민에서 설정 필요)");
    return new Response("no-queries", { status: 200 });
  }

  /* 격주 게이트 — last_cron_at이 13일 이상 경과한 경우에만 실행
     (cron은 매주 화요일 발화 → 한 주는 실행·다음 주는 게이트로 스킵). */
  if (lastCronAt) {
    const daysSince = (Date.now() - lastCronAt.getTime()) / (24 * 60 * 60 * 1000);
    if (daysSince < 13) {
      console.info(`[cron-martyrdom-external] 격주 게이트 — last_cron_at 후 ${daysSince.toFixed(1)}일 (13일 미만 — 스킵)`);
      return new Response("biweekly-skip", { status: 200 });
    }
  }

  /* 3) background 위임 */
  const secret = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (!secret) {
    console.warn("[cron-martyrdom-external] INTERNAL_TRIGGER_SECRET 미설정 — 종료");
    return new Response("secret-missing", { status: 200 });
  }
  const base = process.env.URL || process.env.SITE_URL || "https://tbfa.co.kr";
  const baseUrl = base.startsWith("http") ? base : `https://${base}`;
  const jobId = `cron-ext-${Date.now()}`;

  try {
    const resp = await fetch(`${baseUrl}/.netlify/functions/admin-martyrdom-external-search-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries, engines: ["gemini", "naver"], jobId, secret }),
    });
    console.info(`[cron-martyrdom-external] background trigger status=${resp.status} jobId=${jobId} queries=${queries.length}`);
  } catch (e: any) {
    console.error(`[cron-martyrdom-external] background fetch 실패: ${e?.message}`);
  }

  /* 4) last_cron_at 갱신 */
  try {
    await db.execute(sql`
      UPDATE martyrdom_external_settings SET last_cron_at = NOW()
    `);
  } catch (e: any) {
    console.warn(`[cron-martyrdom-external] last_cron_at 갱신 실패: ${e?.message}`);
  }

  console.info(`[cron-martyrdom-external] 완료 (${Date.now() - startMs}ms)`);
  return new Response("ok", { status: 200 });
};
