/**
 * 뉴스·여론 재조사 — 백그라운드 워커 (Netlify 15분 한도)
 *
 * INTERNAL_TRIGGER_SECRET 인증. admin-org-news-refresh가 트리거(fire-and-forget).
 * 네이버 수집 2회 + Gemini 분석 2회가 26초 함수 한도를 넘어 504 나던 문제 해결(2026-05-26).
 *   수집·분석·INSERT를 여기서 수행 → org_news_reports에 trigger_type='manual'로 기록.
 *   프론트는 admin-org-news-get 폴링으로 새 보고서 등장 확인.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { collectNaverSearch, type NaverSearchScope } from "../../lib/naver-search";
import { analyzeOrgNews, judgeIncidents, sqlTextArray, INCIDENT_KEYWORDS } from "../../lib/org-news-analyze";

const DEFAULT_SETTINGS = {
  keywords: ["교사유가족협의회", "교권침해", "교사 순직", "사립학교 교권"],
  scopes:   ["news"] as NaverSearchScope[],
  perCombo: 20,
};

export default async function handler(req: Request, _ctx: Context) {
  let body: any = {};
  try { body = await req.json(); } catch {}

  /* 내부 호출 인증 (fail-closed) */
  const secret = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (!secret || body.secret !== secret) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), { status: 403 });
  }
  const adminId = body.adminId != null ? Number(body.adminId) : null;

  /* 1. 설정 로드 */
  let keywords = DEFAULT_SETTINGS.keywords;
  let scopes   = DEFAULT_SETTINGS.scopes;
  let perCombo = DEFAULT_SETTINGS.perCombo;
  try {
    const r: any = await db.execute(sql`SELECT keywords, scopes, per_combo FROM org_news_settings LIMIT 1`);
    const row = (r?.rows ?? r ?? [])[0];
    if (row) {
      if (Array.isArray(row.keywords) && row.keywords.length) keywords = row.keywords;
      if (Array.isArray(row.scopes)   && row.scopes.length)   scopes   = row.scopes as NaverSearchScope[];
      if (row.per_combo != null) perCombo = Number(row.per_combo);
    }
  } catch (err) {
    console.warn("[org-news-bg] 설정 로드 실패, 기본값:", (err as any)?.message);
  }

  /* 2. 네이버 수집 */
  let collectResult;
  try {
    collectResult = await collectNaverSearch(keywords, scopes, perCombo);
  } catch (err) {
    console.error("[org-news-bg] 수집 예외:", err);
    return new Response("collect error", { status: 200 });
  }
  if (!collectResult.ok) {
    console.error("[org-news-bg] 수집 실패:", collectResult.error);
    return new Response("collect not ok", { status: 200 });
  }
  const items = collectResult.items;

  /* 3. 직전 보고서 요약 */
  let prevSummary: string | undefined;
  try {
    const pr: any = await db.execute(sql`SELECT summary FROM org_news_reports ORDER BY created_at DESC LIMIT 1`);
    const prevRow = (pr?.rows ?? pr ?? [])[0];
    if (prevRow?.summary) prevSummary = String(prevRow.summary).slice(0, 800);
  } catch { /* 무시 */ }

  /* 4. AI 분석 */
  let analysis;
  try {
    analysis = await analyzeOrgNews(items, prevSummary);
  } catch (err) {
    console.error("[org-news-bg] 분석 예외:", err);
    return new Response("analyze error", { status: 200 });
  }

  /* 4-B. 사건·사고 수집·판정 */
  let incidents: Awaited<ReturnType<typeof judgeIncidents>> = [];
  try {
    const incidentResult = await collectNaverSearch(INCIDENT_KEYWORDS as unknown as string[], ["news"], 20);
    if (incidentResult.ok && incidentResult.items.length) {
      incidents = await judgeIncidents(incidentResult.items);
    }
  } catch (err) {
    console.warn("[org-news-bg] 사건·사고 무시:", (err as any)?.message);
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
         'manual',
         ${adminId},
         NOW())
    `);
  } catch (err) {
    console.error("[org-news-bg] INSERT 실패:", err);
    return new Response("insert error", { status: 200 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
}
