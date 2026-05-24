/**
 * 뉴스·여론 수동 새로고침 API
 *
 * POST /api/admin-org-news-refresh  — super_admin
 *
 * 동작:
 *   1. org_news_settings에서 키워드·범위 로드
 *   2. 네이버 검색 수집 (B1 collectNaverSearch)
 *   3. Gemini AI 분석 (B2 analyzeOrgNews) — 직전 보고서 요약 전달
 *   4. org_news_reports INSERT (trigger_type='manual', generated_by=adminId)
 *   5. 전체 보고서 반환
 *
 * featureKey 월한도 초과 시에도 수동 새로고침은 무제한 (AI 실패 시 partial 반환)
 */

import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { collectNaverSearch, type NaverSearchScope } from "../../lib/naver-search";
import { analyzeOrgNews, judgeIncidents, sqlTextArray, INCIDENT_KEYWORDS } from "../../lib/org-news-analyze";

export const config = { path: "/api/admin-org-news-refresh" };

const DEFAULT_SETTINGS = {
  keywords: ["교사유가족협의회", "교권침해", "교사 순직", "사립학교 교권"],
  scopes:   ["news"] as NaverSearchScope[],
  perCombo: 20,
};

function jsonError(step: string, err: any) {
  return Response.json(
    {
      ok: false,
      error: "새로고침 오류",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack:  String(err?.stack   || "").slice(0, 1000),
    },
    { status: 500 },
  );
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "POST 전용" }, { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const admin   = auth.ctx?.member as any;
  const isSuper = admin?.role === "super_admin";

  if (!isSuper) {
    return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
  }

  /* 1. 설정 로드 */
  let keywords = DEFAULT_SETTINGS.keywords;
  let scopes   = DEFAULT_SETTINGS.scopes;
  let perCombo = DEFAULT_SETTINGS.perCombo;

  try {
    const r: any = await db.execute(sql`
      SELECT keywords, scopes, per_combo FROM org_news_settings LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (row) {
      if (Array.isArray(row.keywords) && row.keywords.length) keywords = row.keywords;
      if (Array.isArray(row.scopes)   && row.scopes.length)   scopes   = row.scopes as NaverSearchScope[];
      if (row.per_combo != null) perCombo = Number(row.per_combo);
    }
  } catch (err) {
    console.warn("[org-news-refresh] 설정 로드 실패, 기본값 사용:", (err as any)?.message);
  }

  /* 2. 네이버 검색 수집 */
  let collectResult;
  try {
    collectResult = await collectNaverSearch(keywords, scopes, perCombo);
  } catch (err) {
    return jsonError("collect", err);
  }

  if (!collectResult.ok) {
    return Response.json({ ok: false, error: collectResult.error || "수집 실패" }, { status: 502 });
  }

  const items = collectResult.items;

  /* 3. 직전 보고서 요약 조회 (비교용) */
  let prevSummary: string | undefined;
  try {
    const pr: any = await db.execute(sql`
      SELECT summary FROM org_news_reports ORDER BY created_at DESC LIMIT 1
    `);
    const prevRow = (pr?.rows ?? pr ?? [])[0];
    if (prevRow?.summary) prevSummary = String(prevRow.summary).slice(0, 800);
  } catch { /* 보조 조회 실패 무시 */ }

  /* 4. AI 분석 */
  let analysis;
  try {
    analysis = await analyzeOrgNews(items, prevSummary);
  } catch (err) {
    return jsonError("analyze", err);
  }

  /* 4-B. 사건·사고 수집 + 판정 */
  let incidents: Awaited<ReturnType<typeof judgeIncidents>> = [];
  try {
    const incidentResult = await collectNaverSearch(INCIDENT_KEYWORDS as unknown as string[], ["news"], 20);
    if (incidentResult.ok && incidentResult.items.length) {
      incidents = await judgeIncidents(incidentResult.items);
    }
  } catch (err) {
    console.warn("[org-news-refresh] 사건·사고 수집/판정 실패 (무시):", (err as any)?.message);
  }

  /* 5. 보고서 INSERT */
  let reportId: number;
  try {
    const ins: any = await db.execute(sql`
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
         ${admin.id},
         NOW())
      RETURNING id
    `);
    const row = (ins?.rows ?? ins ?? [])[0];
    reportId = Number(row?.id);
  } catch (err) {
    return jsonError("insert", err);
  }

  return Response.json({
    ok: true,
    data: {
      id:              reportId!,
      collectedCount:  items.length,
      keywords,
      scopes,
      summary:         analysis.summary,
      keywordCloud:    analysis.keywordCloud,
      sentiment:       analysis.sentiment,
      recommendations: analysis.recommendations,
      diffSummary:     analysis.diffSummary,
      aiStatus:        analysis.status,
      incidents,
      triggerType:     "manual",
      generatedBy:     admin.id,
    },
  });
}
