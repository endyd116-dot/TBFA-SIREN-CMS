// lib/ai-legal.ts
// ★ Phase M-7: 법률 상담 AI 1차 자문
// - 분야/긴급도/관련법령/1차의견/변호사 전문분야

import { callGeminiJSON } from "./ai-gemini";

export interface LegalAIResult {
  category: "school_dispute" | "civil" | "criminal" | "family" | "labor" | "contract" | "other";
  urgency: "urgent" | "high" | "normal" | "low";
  summary: string;
  relatedLaws: string;
  legalOpinion: string;
  lawyerSpecialty: string;
  immediateAction: string;
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
    .replace(/\s+/g, " ").trim().slice(0, 3500);
}

const VALID_CATEGORIES = ["school_dispute", "civil", "criminal", "family", "labor", "contract", "other"];
const VALID_URGENCY = ["urgent", "high", "normal", "low"];

function fallback(title: string, content: string, userCategory: string): LegalAIResult {
  const text = (title + " " + content).toLowerCase();
  let urgency: LegalAIResult["urgency"] = "normal";

  const urgentKw = ["폭행", "성폭력", "체포", "구속", "기소", "긴급", "당장", "내일"];
  const highKw = ["고소", "고발", "소장", "송달", "이혼", "위자료", "손해배상"];
  const lowKw = ["문의", "참고", "궁금"];

  if (urgentKw.some((k) => text.includes(k))) urgency = "urgent";
  else if (highKw.some((k) => text.includes(k))) urgency = "high";
  else if (lowKw.some((k) => text.includes(k))) urgency = "low";

  const cat = VALID_CATEGORIES.includes(userCategory) ? userCategory : "school_dispute";

  return {
    category: cat as any,
    urgency,
    summary: "AI 법률 분석을 일시적으로 사용할 수 없어 키워드 기반으로 분류되었습니다.",
    relatedLaws: "정확한 관련 법령은 변호사 매칭 후 확인하실 수 있습니다.",
    legalOpinion: "본 사안은 전문 변호사의 검토가 필요합니다. 사이렌 정식 신청을 통해 변호사 매칭을 받으시길 권장드립니다.",
    lawyerSpecialty: "교육법 / 일반 민·형사",
    immediateAction: "관련 자료(이메일·문자·녹음·계약서 등)를 모두 보관하시고, 가능한 빨리 변호사 자문을 받으세요.",
    suggestion: "사이렌은 교육 관련 분쟁에 경험 많은 변호사 패널과 연결해 드립니다. 정식 신청 시 사안에 맞는 전문가가 배정됩니다.",
    fromAi: false,
  };
}

export async function analyzeLegalConsultation(opts: {
  userCategory: string;
  userUrgency?: string;
  reportTitle: string;
  reportContent: string;
  partyInfo?: string;
}): Promise<LegalAIResult> {
  const { userCategory, userUrgency, reportTitle, reportContent, partyInfo } = opts;
  const text = htmlToText(reportContent);

  if (!text || text.length < 10) {
    return fallback(reportTitle, text, userCategory);
  }

  const urgencyLabel = userUrgency === "urgent" ? "긴급"
    : userUrgency === "normal" ? "보통"
    : userUrgency === "reference" ? "참고용" : "미상";

  // lib/ai-legal.ts — analyzeLegalConsultation 내 prompt 변수 시작 부분 교체
  const prompt = `당신은 한국 교사유가족협의회 "사이렌"의 법률 정보 안내 AI 어시스턴트입니다.
당신은 변호사가 아니며, 제공하는 답변은 일반적인 법률 정보 안내일 뿐 법률 자문이 아닙니다.
하지만 당신은 최고수준의 법 지식과 판례를 알고있는 사람으로써 사용자에게 적절한 자문을 받을 수 있도록 최대한 상세하고 친절하게 안내해야 합니다.
사용자가 제공한 정보를 바탕으로, 가장 관련성이 높은 법률 분야(학교 분쟁, 민사, 형사, 가사, 노동, 계약, 기타)와 긴급도를 판단하여 안내 메시지를 작성하세요.
법률 자문은 반드시 변호사와의 상담을 통해 받아야 합니다.

다음 원칙을 따르세요:
- 사안의 심각도 판단 시 객관적 정보만 제공
- 사안이 심각하다고 판단되면 즉시 변호사 상담 또는 사이렌 정식 신청을 권장
- 사안이 경미해 보이더라도 "변호사 상담을 통해 정확한 판단을 받으시길 권장합니다" 안내 필수
- 법령 조문은 일반적인 참고 정보로만 제시하고, 정확한 적용은 변호사 판단 영역임을 명시


다음 법률 상담 신청을 분석하여 JSON으로만 응답하세요. 코드블록(\`\`\`)은 포함하지 마세요.

[사용자 분류] ${userCategory}
[사용자 긴급도] ${urgencyLabel}
[상대방 정보] ${partyInfo || "(미입력)"}
[제목] ${reportTitle}
[본문]
${text}

분석 항목:
1. category: AI 재분류
   - "school_dispute": 학교 내 분쟁 (교권 침해, 징계, 학교계약)
   - "civil": 민사 (손해배상, 명예훼손, 채무)
   - "criminal": 형사 (폭행, 협박, 무고, 사기)
   - "family": 가사 (이혼, 상속, 양육권)
   - "labor": 노동 (해고, 임금, 노조)
   - "contract": 계약 (임대차, 매매, 일반계약)
   - "other": 기타

2. urgency: 긴급도
   - "urgent": 24~72시간 내 조치 필요 (구속, 체포, 기소, 형사고소 임박)
   - "high": 1~2주 내 대응 필요 (소장 송달, 합의 마감)
   - "normal": 일반 절차로 충분
   - "low": 단순 자문/참고

3. summary: 법적 사안의 핵심을 2~3문장(150자 이내)으로 요약

4. relatedLaws: 관련 가능성 있는 법령을 명시. 형식: "○○법 제○조, ○○법 제○조" (500자 이내). 정확한 조문이 불명확하면 "사안에 따라 ○○법, ○○법 등이 검토될 수 있습니다" 식으로 안내.

5. legalOpinion: 1차 법률 의견을 2~3문장(500자 이내)으로 제시. 단, "이는 1차 자문이며 정확한 판단은 변호사와 상담이 필요합니다" 안내 포함.

6. lawyerSpecialty: 권장 변호사 전문분야 (예: "교육법, 행정법", "민사 손해배상 전문", "이혼·가사 전문") (60자 이내)

7. immediateAction: 사용자가 지금 당장 해야 할 일 2~3문장(400자 이내). 증거 보관, 시효 임박, 신고/소송 준비 등.

8. suggestion: 사이렌의 변호사 매칭 서비스 안내 + 따뜻한 어조 (500자 이내)

응답 형식 (JSON):
{
  "category": "school_dispute" | "civil" | "criminal" | "family" | "labor" | "contract" | "other",
  "urgency": "urgent" | "high" | "normal" | "low",
  "summary": "...",
  "relatedLaws": "...",
  "legalOpinion": "...",
  "lawyerSpecialty": "...",
  "immediateAction": "...",
  "suggestion": "..."
}`;

  try {
    const result = await callGeminiJSON<any>(prompt, { temperature: 0.3, maxOutputTokens: 3000 });
    if (!result.ok || !result.data) {
      return fallback(reportTitle, text, userCategory);
    }

    const d = result.data;
    return {
      category: VALID_CATEGORIES.includes(d.category) ? d.category : (VALID_CATEGORIES.includes(userCategory) ? userCategory : "school_dispute") as any,
      urgency: VALID_URGENCY.includes(d.urgency) ? d.urgency : "normal",
      summary: String(d.summary || "").slice(0, 500),
      relatedLaws: String(d.relatedLaws || "").slice(0, 600),
      legalOpinion: String(d.legalOpinion || "").slice(0, 800),
      lawyerSpecialty: String(d.lawyerSpecialty || "").slice(0, 200),
      immediateAction: String(d.immediateAction || "").slice(0, 600),
      suggestion: String(d.suggestion || "").slice(0, 600),
      fromAi: true,
    };
  } catch (e) {
    console.error("[ai-legal] 예외:", e);
    return fallback(reportTitle, text, userCategory);
  }
}