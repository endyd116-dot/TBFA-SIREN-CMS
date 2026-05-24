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
 *
 * judgeIncidents 반환 구조:
 *   [{title, link, source, pubDate, relevance, urgency, reason, suggestedAction}]
 *   — 협회 참여 여지 있는 사건·사고만 추려 relevance/urgency 산출
 *   — AI 실패 시 빈 배열 (status 영향 없음)
 */

import { sql } from "drizzle-orm";
import { callGeminiJSON } from "./ai-gemini";
import type { NaverSearchItem } from "./naver-search";

/** 협회 관련 사건·사고 수집에 사용하는 키워드 상수 (설정 키워드와 별개) */
export const INCIDENT_KEYWORDS = [
  "교사 사망",
  "교사 순직",
  "교권 침해",
  "학교 사건사고",
  "교사 추락",
  "교사 극단적 선택",
  "교원 순직",
] as const;

export interface IncidentItem {
  title:           string;
  link:            string;
  source:          string;   // 수집 키워드
  pubDate:         string;
  relevance:       number;   // 0~100 협회 관련도
  urgency:         "높음" | "보통" | "낮음";
  reason:          string;
  suggestedAction: string;
}

/** JS 문자열 배열 → Postgres text[] 바인딩.
 *  drizzle `sql` 템플릿은 `${jsArray}`를 콤마로 펼쳐 레코드(a,b,c)로 만들어
 *  text[] 컬럼 INSERT 시 "expression is of type record" 오류가 난다.
 *  ARRAY[$1,$2,...]::text[] 로 각 원소를 개별 파라미터 바인딩(한글·따옴표 안전). 빈 배열은 ARRAY[]::text[]. */
export function sqlTextArray(arr: string[]) {
  return sql`ARRAY[${sql.join((arr ?? []).map((x) => sql`${x}`), sql`, `)}]::text[]`;
}

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

/**
 * 사건·사고 기사 목록 → Gemini가 협회 참여 여지 있는 사건만 추려 판정
 *
 * AI 실패 시 빈 배열 반환 (fire-and-forget 안전 — status 영향 없음)
 */
export async function judgeIncidents(
  items: NaverSearchItem[],
): Promise<IncidentItem[]> {
  if (!items.length) return [];

  const snippets = items
    .slice(0, 50)
    .map((it, i) =>
      `[${i + 1}] (${it.keyword}) ${it.date.slice(0, 10)} — ${it.title}\n${it.description.slice(0, 150)}`
    )
    .join("\n\n");

  const prompt = `당신은 한국 교사유가족협의회의 사건·사고 모니터링 담당자입니다.
아래는 최근 1주간 교사 관련 사건·사고 키워드로 수집된 뉴스 목록입니다.
수집 건수: ${items.length}건

---
${snippets}
---

위 기사 중 "(사)교사유가족협의회"가 관심을 갖거나 실제 개입·지원·성명 발표를 고려할 만한 사건·사고만 추려내세요.
단순 홍보·정책 기사·협회와 무관한 내용은 제외하세요.

아래 JSON 형식으로만 응답하세요(한국어, 코드블록 없이):
{
  "incidents": [
    {
      "title": "기사 제목",
      "link": "기사 URL",
      "source": "수집 키워드",
      "pubDate": "날짜(ISO 또는 원본)",
      "relevance": 0~100,
      "urgency": "높음|보통|낮음",
      "reason": "협회가 주목해야 하는 이유 1~2문장",
      "suggestedAction": "협회가 취할 수 있는 구체 대응 1문장"
    }
  ]
}

urgency 기준:
- 높음: 교사 사망·순직 등 즉각 대응 필요
- 보통: 교권 침해·학교 사건 등 모니터링·준비 필요
- 낮음: 관련 동향이나 잠재적 관심사

관련 없으면 "incidents": [] 로 응답.`;

  const result = await callGeminiJSON<{ incidents: IncidentItem[] }>(prompt, {
    featureKey:      "org_news_analysis",
    mode:            "pro",
    maxOutputTokens: 2000,
  });

  if (result.ok && result.data && Array.isArray(result.data.incidents)) {
    return result.data.incidents
      .filter((it: any) => it && typeof it.title === "string" && it.title)
      .map((it: any): IncidentItem => ({
        title:           String(it.title           || "").slice(0, 300),
        link:            String(it.link            || ""),
        source:          String(it.source          || ""),
        pubDate:         String(it.pubDate         || ""),
        relevance:       typeof it.relevance === "number" ? Math.max(0, Math.min(100, it.relevance)) : 50,
        urgency:         ["높음", "보통", "낮음"].includes(it.urgency) ? it.urgency : "보통",
        reason:          String(it.reason          || "").slice(0, 300),
        suggestedAction: String(it.suggestedAction || "").slice(0, 300),
      }));
  }

  console.warn("[org-news-analyze] judgeIncidents AI 실패 — 빈 배열 반환:", result.error);
  return [];
}
