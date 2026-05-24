/**
 * 뉴스·여론 수집 결과 → Gemini AI 분석
 *
 * 반환 구조:
 *   summary            — 전체 동향 요약 (한국어 단락)
 *   keywordCloud       — [{text, weight}] 빈도 기반 키워드
 *   sentiment          — {label, positive, neutral, negative, reason}
 *   recommendations    — [{title, detail}] 운영 대응 제안
 *   diffSummary        — 직전 보고서 대비 변화 요약 (없으면 빈 문자열)
 *   status             — 'full' | 'partial' (AI 실패 시 partial)
 */

import { callGeminiJSON } from "./ai-gemini";
import type { NaverSearchItem } from "./naver-search";

export interface KeywordWeight {
  text: string;
  weight: number;
}

export interface SentimentResult {
  label: "positive" | "neutral" | "negative" | "mixed";
  positive: number;   // 0~100
  neutral:  number;
  negative: number;
  reason:   string;
}

export interface NewsRecommendation {
  title:  string;
  detail: string;
}

export interface OrgNewsAnalysis {
  summary:         string;
  keywordCloud:    KeywordWeight[];
  sentiment:       SentimentResult;
  recommendations: NewsRecommendation[];
  diffSummary:     string;
  status:          "full" | "partial";
}

/* 폴백: 수집 항목에서 휴리스틱 키워드 추출 */
function heuristicKeywords(items: NaverSearchItem[]): KeywordWeight[] {
  const freq = new Map<string, number>();
  for (const item of items) {
    const words = (item.title + " " + item.description)
      .split(/[\s,·\-–—「」『』【】〔〕《》〈〉]+/)
      .map(w => w.trim())
      .filter(w => w.length >= 2 && w.length <= 12);
    for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([text, weight]) => ({ text, weight }));
}

/* 폴백: 수집 항목 제목으로 짧은 요약 생성 */
function heuristicSummary(items: NaverSearchItem[]): string {
  if (!items.length) return "수집된 기사가 없습니다.";
  const titles = items.slice(0, 5).map(i => i.title).join(" / ");
  return `최근 1주간 ${items.length}건의 관련 기사가 수집되었습니다. 주요 주제: ${titles}`;
}

export async function analyzeOrgNews(
  items: NaverSearchItem[],
  prevReportSummary?: string,
): Promise<OrgNewsAnalysis> {
  const snippets = items
    .slice(0, 60)
    .map((it, i) =>
      `[${i + 1}] (${it.scope}·${it.keyword}) ${it.date.slice(0, 10)} — ${it.title}\n${it.description.slice(0, 150)}`
    )
    .join("\n\n");

  const diffSection = prevReportSummary
    ? `\n\n### 직전 보고서 요약 (비교용)\n${prevReportSummary.slice(0, 600)}`
    : "";

  const prompt = `당신은 한국 비영리단체 운영 분석 전문가입니다.
아래는 "(사)교사유가족협의회" 관련 최근 1주간 뉴스·블로그·웹 수집 결과입니다.
수집 건수: ${items.length}건${diffSection}

---
${snippets}
---

위 자료를 분석하여 아래 JSON 형식으로만 응답하세요(한국어, 코드블록 없이):
{
  "summary": "전체 동향 요약 (200~400자 단락)",
  "keywordCloud": [{"text":"키워드","weight":빈도_정수}, ...최대20개],
  "sentiment": {
    "label": "positive|neutral|negative|mixed",
    "positive": 0~100,
    "neutral": 0~100,
    "negative": 0~100,
    "reason": "감성 판단 근거 1~2문장"
  },
  "recommendations": [
    {"title":"제목","detail":"구체 대응 방안"},
    ...최대5개
  ],
  "diffSummary": "직전 보고서 대비 주요 변화 (없으면 빈 문자열)"
}`;

  const result = await callGeminiJSON<OrgNewsAnalysis>(prompt, {
    featureKey:      "org_news_analysis",
    mode:            "pro",
    maxOutputTokens: 4000,
  });

  if (result.ok && result.data) {
    const d = result.data;
    /* 필수 필드 방어 */
    return {
      summary:         d.summary         || heuristicSummary(items),
      keywordCloud:    Array.isArray(d.keywordCloud) && d.keywordCloud.length
        ? d.keywordCloud : heuristicKeywords(items),
      sentiment: {
        label:    d.sentiment?.label    || "neutral",
        positive: d.sentiment?.positive ?? 33,
        neutral:  d.sentiment?.neutral  ?? 34,
        negative: d.sentiment?.negative ?? 33,
        reason:   d.sentiment?.reason   || "",
      },
      recommendations: Array.isArray(d.recommendations) ? d.recommendations : [],
      diffSummary:     d.diffSummary    || "",
      status:          "full",
    };
  }

  /* AI 실패 — 폴백 (partial) */
  console.warn("[org-news-analyze] AI 분석 실패, 휴리스틱 폴백 사용:", result.error);
  return {
    summary:         heuristicSummary(items),
    keywordCloud:    heuristicKeywords(items),
    sentiment: {
      label:    "neutral",
      positive: 33,
      neutral:  34,
      negative: 33,
      reason:   "AI 분석 실패로 자동 판단 불가",
    },
    recommendations: [],
    diffSummary:     "",
    status:          "partial",
  };
}
