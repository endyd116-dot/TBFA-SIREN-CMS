// lib/ai-incident.ts
// ★ Phase M-5: 사건 제보 AI 분석 (위급도 + 요약 + 권장 후속조치)
// - Gemini callGeminiJSON 사용
// - 실패 시 키워드 기반 폴백
// - try-catch로 격리되어 있어 본 작업을 막지 않음

import { callGeminiJSON } from "./ai-gemini";

export interface IncidentAIResult {
  severity: "low" | "medium" | "high" | "critical";
  summary: string;
  suggestion: string;
  fromAi: boolean;
}

/* HTML → 텍스트 (간단 변환, AI 토큰 절약) */
function htmlToText(html: string): string {
  return String(html || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);
}

/* 키워드 기반 폴백 */
function fallbackAnalysis(title: string, content: string): IncidentAIResult {
  const text = (title + " " + content).toLowerCase();
  let severity: IncidentAIResult["severity"] = "medium";

  const criticalKeywords = ["자살", "사망", "폭행", "성폭력", "성희롱", "아동학대", "협박"];
  const highKeywords = ["폭언", "괴롭힘", "차별", "강압", "불법", "의심", "은폐"];
  const lowKeywords = ["문의", "궁금", "건의", "제안"];

  if (criticalKeywords.some((k) => text.includes(k))) severity = "critical";
  else if (highKeywords.some((k) => text.includes(k))) severity = "high";
  else if (lowKeywords.some((k) => text.includes(k))) severity = "low";

  return {
    severity,
    summary: "AI 분석을 일시적으로 사용할 수 없어 키워드 기반으로 분류되었습니다. 관리자가 검토 시 더 자세한 분석이 진행됩니다.",
    suggestion: severity === "critical"
      ? "긴급한 사안으로 보입니다. 정식 접수 시 즉시 관리자가 우선 검토합니다."
      : "사이렌 운영진이 검토 후 적절한 후속조치를 안내해 드립니다.",
    fromAi: false,
  };
}

/**
 * 사건 제보 AI 분석
 */
export async function analyzeIncidentReport(opts: {
  incidentTitle?: string;
  reportTitle: string;
  reportContent: string;
}): Promise<IncidentAIResult> {
  const { incidentTitle, reportTitle, reportContent } = opts;
  const text = htmlToText(reportContent);

  if (!text || text.length < 10) {
    return fallbackAnalysis(reportTitle, text);
  }

  const prompt = `당신은 한국 교사유가족협의회 "사이렌"의 사건 제보 분석 AI입니다.

다음 사용자 제보를 분석하여 JSON으로만 응답하세요. 코드블록(\`\`\`)은 포함하지 마세요.

[사건명] ${incidentTitle || "(특정 사건 미연결)"}
[제보 제목] ${reportTitle}
[제보 본문]
${text}

분석 항목:
1. severity: 사안의 위급도를 다음 4단계 중 하나로 분류
   - "critical": 생명 위협, 자살, 사망, 성범죄, 아동학대 관련 (즉시 대응 필요)
   - "high": 폭언/폭행/괴롭힘/심각한 교권 침해 (긴급 검토)
   - "medium": 일반적 교권 침해, 부당한 처우 (정상 절차)
   - "low": 일반 의견, 건의, 단순 정보 제보

2. summary: 제보 내용을 2~3문장(150자 이내)으로 객관적으로 요약. 신원 정보는 제거.

3. suggestion: 제보자에게 권장하는 후속조치를 5문장(500자 이내)으로 제시. 따뜻하고 공감적인 어조 사용. 필요 시 사이렌 정식 접수, 1:1 상담, 법률 자문, 심리 상담 등을 안내.

응답 형식 (JSON):
{
  "severity": "low" | "medium" | "high" | "critical",
  "summary": "...",
  "suggestion": "..."
}`;

  try {
    const result = await callGeminiJSON<{ severity: string; summary: string; suggestion: string }>(
      prompt,
      { temperature: 0.3, maxOutputTokens: 2000 }
    );

    if (!result.ok || !result.data) {
      console.warn("[ai-incident] AI 분석 실패, 폴백 사용:", result.error);
      return fallbackAnalysis(reportTitle, text);
    }

    const sev = String(result.data.severity || "medium").toLowerCase();
    const validSeverity: IncidentAIResult["severity"] =
      ["low", "medium", "high", "critical"].includes(sev) ? (sev as any) : "medium";

    return {
      severity: validSeverity,
      summary: String(result.data.summary || "").slice(0, 500),
      suggestion: String(result.data.suggestion || "").slice(0, 600),
      fromAi: true,
    };
  } catch (e) {
    console.error("[ai-incident] 예외:", e);
    return fallbackAnalysis(reportTitle, text);
  }
}