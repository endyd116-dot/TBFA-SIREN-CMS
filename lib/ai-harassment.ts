// lib/ai-harassment.ts
// ★ Phase M-6: 악성민원 신고 AI 분석
// - 분류 + 심각도 + 즉각대처 + 법적검토 + 심리지원

import { callGeminiJSON } from "./ai-gemini";

export interface HarassmentAIResult {
  category: "parent" | "student" | "admin" | "colleague" | "other";
  severity: "low" | "medium" | "high" | "critical";
  summary: string;
  immediateAction: string;
  legalReviewNeeded: boolean;
  legalReason: string;
  psychSupportNeeded: boolean;
  suggestion: string;
  fromAi: boolean;
}

function htmlToText(html: string): string {
  return String(html || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ").trim().slice(0, 3000);
}

function fallback(title: string, content: string, userCategory: string): HarassmentAIResult {
  const text = (title + " " + content).toLowerCase();
  let severity: HarassmentAIResult["severity"] = "medium";

  const criticalKw = ["폭행", "성희롱", "성폭력", "협박", "자살", "살해", "흉기"];
  const highKw = ["폭언", "욕설", "모욕", "스토킹", "괴롭힘", "차별", "강요"];
  const lowKw = ["문의", "건의"];

  if (criticalKw.some((k) => text.includes(k))) severity = "critical";
  else if (highKw.some((k) => text.includes(k))) severity = "high";
  else if (lowKw.some((k) => text.includes(k))) severity = "low";

  const validCat = ["parent", "student", "admin", "colleague", "other"];
  const cat = validCat.includes(userCategory) ? userCategory : "parent";

  return {
    category: cat as any,
    severity,
    summary: "AI 분석을 일시적으로 사용할 수 없어 키워드 기반으로 분류되었습니다.",
    immediateAction: "교권보호위원회 신고와 관련 증거 자료 보관을 권장드립니다. 가능하면 즉시 사이렌 운영진에 1:1 상담을 신청하세요.",
    legalReviewNeeded: severity === "critical" || severity === "high",
    legalReason: severity === "critical" || severity === "high"
      ? "심각한 사안으로 판단되어 법률 자문이 필요할 수 있습니다."
      : "현재로서는 법적 검토보다는 학교 내 조정으로 해결 가능해 보입니다.",
    psychSupportNeeded: severity === "critical" || severity === "high",
    suggestion: "사이렌 정식 신고를 통해 운영진의 종합적 검토를 받으시거나, 1:1 상담을 통해 자세한 안내를 받으실 수 있습니다.",
    fromAi: false,
  };
}

export async function analyzeHarassmentReport(opts: {
  userCategory: string;
  reportTitle: string;
  reportContent: string;
  frequency?: string;
}): Promise<HarassmentAIResult> {
  const { userCategory, reportTitle, reportContent, frequency } = opts;
  const text = htmlToText(reportContent);

  if (!text || text.length < 10) {
    return fallback(reportTitle, text, userCategory);
  }

  const freqLabel = frequency === "once" ? "1회성"
    : frequency === "recurring" ? "반복적"
    : frequency === "ongoing" ? "현재 진행 중" : "미상";

  const prompt = `당신은 한국 교사유가족협의회 "사이렌"의 교권 침해/악성민원 분석 AI입니다.

다음 교사의 신고를 분석하여 JSON으로만 응답하세요. 코드블록(\`\`\`)은 포함하지 마세요.

[사용자 분류] ${userCategory}
[발생 빈도] ${freqLabel}
[제목] ${reportTitle}
[본문]
${text}

분석 항목:
1. category: AI가 다시 분류 (사용자 분류와 다를 수 있음)
   - "parent": 학부모 민원/폭언/협박/스토킹
   - "student": 학생의 폭력/모욕/수업 방해/허위 신고
   - "admin": 관리자(교장/교감)/상급자의 부당 지시/괴롭힘
   - "colleague": 동료 교사 간 갈등/따돌림
   - "other": 위에 해당하지 않음

2. severity: 사안의 심각도
   - "critical": 폭행/성범죄/협박/자살 위협 등 즉시 대응 필요
   - "high": 지속적 폭언/스토킹/심각한 명예훼손 등 긴급
   - "medium": 일반적 부당 처우, 반복적 민원
   - "low": 단순 갈등, 일회성 사건

3. summary: 상황을 2~3문장(150자 이내)으로 객관적 요약. 신원 정보 제거.

4. immediateAction: 교사가 지금 당장 취해야 할 조치를 2~3문장(200자 이내). 증거 보관, 학교/교육청 신고, 의료기관 등.

5. legalReviewNeeded: 법률 자문이 필요한가? (true/false)
6. legalReason: 위 판단의 근거를 1~2문장(150자 이내)

7. psychSupportNeeded: 심리상담 지원이 필요한가? (true/false)

8. suggestion: 사이렌이 제공할 수 있는 도움(법률 자문/심리 상담/정식 신고)을 안내하며 따뜻하고 공감적인 어조로 2~3문장(200자 이내)

응답 형식 (JSON):
{
  "category": "parent" | "student" | "admin" | "colleague" | "other",
  "severity": "low" | "medium" | "high" | "critical",
  "summary": "...",
  "immediateAction": "...",
  "legalReviewNeeded": true | false,
  "legalReason": "...",
  "psychSupportNeeded": true | false,
  "suggestion": "..."
}`;

  try {
    const result = await callGeminiJSON<any>(prompt, { temperature: 0.3, maxOutputTokens: 1200 });
    if (!result.ok || !result.data) {
      return fallback(reportTitle, text, userCategory);
    }

    const d = result.data;
    const validCat = ["parent", "student", "admin", "colleague", "other"];
    const validSev = ["low", "medium", "high", "critical"];

    return {
      category: validCat.includes(d.category) ? d.category : (validCat.includes(userCategory) ? userCategory : "parent") as any,
      severity: validSev.includes(d.severity) ? d.severity : "medium",
      summary: String(d.summary || "").slice(0, 500),
      immediateAction: String(d.immediateAction || "").slice(0, 600),
      legalReviewNeeded: !!d.legalReviewNeeded,
      legalReason: String(d.legalReason || "").slice(0, 400),
      psychSupportNeeded: !!d.psychSupportNeeded,
      suggestion: String(d.suggestion || "").slice(0, 600),
      fromAi: true,
    };
  } catch (e) {
    console.error("[ai-harassment] 예외:", e);
    return fallback(reportTitle, text, userCategory);
  }
}