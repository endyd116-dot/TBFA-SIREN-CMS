/**
 * 뉴스·여론 자동 수집·분석 cron
 *
 * KST 09:00 = UTC 00:00  →  schedule "0 0 * * *"
 *
 * 동작:
 *   1. org_news_settings.auto_enabled 확인 — false면 즉시 종료
 *   2. 설정 키워드·범위로 네이버 검색 수집
 *   3. Gemini AI 분석 (직전 보고서 요약 전달)
 *   4. org_news_reports INSERT (trigger_type='cron', generated_by=NULL)
 */

import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { collectNaverSearch, type NaverSearchScope } from "../../lib/naver-search";
import { analyzeOrgNews, judgeIncidents, sqlTextArray, INCIDENT_KEYWORDS } from "../../lib/org-news-analyze";

export const config = {
  schedule: "0 0 * * *",  // UTC 00:00 = KST 09:00
};

const DEFAULT_SETTINGS = {
  keywords: ["교사유가족협의회", "교권침해", "교사 순직", "사립학교 교권"],
  scopes:   ["news"] as NaverSearchScope[],
  perCombo: 20,
};

export default async (_req: Request, _ctx: Context) => {
  const start = Date.now();
  console.info("[cron-org-news] 시작", new Date().toISOString());

  /* 1. 설정 + auto_enabled 확인 */
  let keywords    = DEFAULT_SETTINGS.keywords;
  let scopes      = DEFAULT_SETTINGS.scopes;
  let perCombo    = DEFAULT_SETTINGS.perCombo;
  let autoEnabled = true;

  try {
    const r: any = await db.execute(sql`
      SELECT keywords, scopes, per_combo, auto_enabled
        FROM org_news_settings
       LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (row) {
      autoEnabled = row.auto_enabled !== false;
      if (Array.isArray(row.keywords) && row.keywords.length) keywords = row.keywords;
      if (Array.isArray(row.scopes)   && row.scopes.length)   scopes   = row.scopes as NaverSearchScope[];
      if (row.per_combo != null) perCombo = Number(row.per_combo);
    }
  } catch (err) {
    console.warn("[cron-org-news] 설정 로드 실패, 기본값 사용:", (err as any)?.message);
  }

  if (!autoEnabled) {
    console.info("[cron-org-news] auto_enabled=false — 건너뜀");
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: "auto_enabled=false" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  /* 2. 네이버 검색 수집 */
  let items: Awaited<ReturnType<typeof collectNaverSearch>>["items"] = [];
  try {
    const result = await collectNaverSearch(keywords, scopes, perCombo);
    if (!result.ok) {
      console.error("[cron-org-news] 수집 실패:", result.error);
      return new Response(
        JSON.stringify({ ok: false, error: result.error }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
    items = result.items;
  } catch (err: any) {
    console.error("[cron-org-news] 수집 exception:", err?.message);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "수집 실패" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  /* 3. 직전 보고서 요약 조회 */
  let prevSummary: string | undefined;
  try {
    const pr: any = await db.execute(sql`
      SELECT summary FROM org_news_reports ORDER BY created_at DESC LIMIT 1
    `);
    const prev = (pr?.rows ?? pr ?? [])[0];
    if (prev?.summary) prevSummary = String(prev.summary).slice(0, 800);
  } catch { /* 보조 조회 실패 무시 */ }

  /* 4. AI 분석 */
  let analysis;
  try {
    analysis = await analyzeOrgNews(items, prevSummary);
  } catch (err: any) {
    console.error("[cron-org-news] 분석 exception:", err?.message);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "분석 실패" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  /* 4-B. 사건·사고 수집 + 판정 */
  let incidents: Awaited<ReturnType<typeof judgeIncidents>> = [];
  try {
    const incidentResult = await collectNaverSearch(INCIDENT_KEYWORDS as unknown as string[], ["news"], 20);
    if (incidentResult.ok && incidentResult.items.length) {
      incidents = await judgeIncidents(incidentResult.items);
    }
  } catch (err: any) {
    console.warn("[cron-org-news] 사건·사고 수집/판정 실패 (무시):", err?.message);
  }

  /* 5. 보고서 INSERT */
  try {
    await db.execute(sql`
      INSERT INTO org_news_reports
        (keywords, scopes, per_combo, collected_count, items,
         summary, keyword_cloud, sentiment, recommendations, diff_summary,
         ai_status, incidents, trigger_type, generated_by, created_at)
      VALUES
        (${sqlTextArray(keywords)}, ${sqlTextArray(scopes)}, ${perCombo}, ${items.length},
         ${JSON.stringify(items)}::jsonb,
         ${analysis.summary},
         ${JSON.stringify(analysis.keywordCloud)}::jsonb,
         ${JSON.stringify(analysis.sentiment)}::jsonb,
         ${JSON.stringify(analysis.recommendations)}::jsonb,
         ${analysis.diffSummary},
         ${analysis.status},
         ${JSON.stringify(incidents)}::jsonb,
         'cron',
         NULL,
         NOW())
    `);
  } catch (err: any) {
    console.error("[cron-org-news] INSERT 실패:", err?.message);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "저장 실패" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const durationMs = Date.now() - start;
  console.info(`[cron-org-news] 완료 — 수집 ${items.length}건, AI상태 ${analysis.status} (${durationMs}ms)`);

  return new Response(
    JSON.stringify({
      ok:            true,
      collectedCount: items.length,
      aiStatus:      analysis.status,
      durationMs,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
