/**
 * AI 기반 우선순위(긴급도) 분석 — STEP E-4a
 *
 * 신청 내용을 종합 분석하여 우선순위 판단:
 *   - urgent: 즉시 처리 필요 (위급/자해/응급/긴급 키워드 + 정황)
 *   - normal: 일반 (기본값)
 *   - low: 일반 문의/장기 사안
 */
import { callGeminiJSON } from "./ai-gemini";

export type PriorityLevel = "urgent" | "normal" | "low";

export interface PriorityAnalysis {
  priority: PriorityLevel;
  reason: string;       // 한글 1-2문장
  confidence: number;   // 0.0 ~ 1.0
}

/* 카테고리 한글 라벨 (프롬프트용) */
const CATEGORY_LABEL: Record<string, string> = {
  counseling: "심리상담",
  legal: "법률자문",
  scholarship: "장학사업",
  other: "기타",
};

/**
 * 신청 내용을 분석하여 우선순위 반환
 * 실패 시 fallback으로 'normal' 반환 (서비스 영향 없음)
 */
export async function analyzePriority(input: {
  category: string;
  title: string;
  content: string;
}): Promise<PriorityAnalysis> {
  const categoryKr = CATEGORY_LABEL[input.category] || input.category;

  const prompt = `당신은 교사유가족협의회 NPO의 지원 신청을 검토하는 전문 상담 코디네이터입니다.
아래 신청 내용을 종합적으로 분석하여 처리 우선순위를 판단하세요.

# 우선순위 기준

## urgent (긴급 — 즉시 처리)
- 자해, 자살, 극단적 선택 등 위험 신호 언급
- 응급 의료/심리 위기 상황
- 미성년 자녀의 즉각적 보호 필요
- 법적 시한 임박한 사안 (소멸시효 등)
- 절박감, 도움 호소가 매우 강한 표현

## normal (일반 — 표준 처리)
- 명확한 사유와 필요가 있으나 즉각적 위험은 없음
- 일반적인 상담/자문/장학 신청

## low (낮음 — 여유 있게 처리)
- 단순 문의/안내 요청
- 장기 계획성 사안 (예: 다음 학기 장학금 사전 문의)

# 신청 정보
- 카테고리: ${categoryKr}
- 제목: ${input.title}
- 내용: ${input.content.slice(0, 1500)}${input.content.length > 1500 ? "..." : ""}

# 응답 형식
JSON 객체로만 응답하세요. 설명 없이 JSON만 출력:

{
  "priority": "urgent" | "normal" | "low",
  "reason": "판단 근거를 한글 1-2문장으로 (40자 이내)",
  "confidence": 0.0~1.0 사이 숫자
}`;

  try {
    const result = await callGeminiJSON<PriorityAnalysis>(prompt, {
      temperature: 0.2,
      maxOutputTokens: 500,
    });

    if (result.ok && result.data) {
      const p = normalizePriority(result.data.priority);
      return {
        priority: p,
        reason: String(result.data.reason || "AI 자동 분석").slice(0, 100),
        confidence: clampConfidence(result.data.confidence),
      };
    }

    /* AI 실패 시 키워드 기반 폴백 */
    return keywordFallback(input);
  } catch (err) {
    console.error("[ai-priority] 분석 예외:", err);
    return keywordFallback(input);
  }
}

/**
 * AI 실패 시 안전망 — 키워드 기반 단순 분류
 */
function keywordFallback(input: {
  category: string;
  title: string;
  content: string;
}): PriorityAnalysis {
  const text = (input.title + " " + input.content).toLowerCase();

  /* 긴급 키워드 */
  const urgentKeywords = [
    "자해", "자살", "죽고", "죽고싶", "끝내고싶",
    "응급", "긴급", "위급", "위기",
    "지금 당장", "오늘", "내일까지",
    "도와주세요", "살려주세요",
  ];
  for (const kw of urgentKeywords) {
    if (text.includes(kw)) {
      return {
        priority: "urgent",
        reason: `긴급 키워드 감지: "${kw}"`,
        confidence: 0.7,
      };
    }
  }

  /* 일반 문의 키워드 */
  const lowKeywords = ["문의", "궁금", "알고싶", "안내"];
  for (const kw of lowKeywords) {
    if (text.includes(kw) && text.length < 100) {
      return {
        priority: "low",
        reason: "단순 문의로 판단",
        confidence: 0.5,
      };
    }
  }

  return {
    priority: "normal",
    reason: "AI 분석 실패 → 기본값",
    confidence: 0.3,
  };
}

function normalizePriority(p: any): PriorityLevel {
  const v = String(p || "").toLowerCase();
  if (v === "urgent" || v === "normal" || v === "low") return v;
  return "normal";
}

function clampConfidence(c: any): number {
  const n = Number(c);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}