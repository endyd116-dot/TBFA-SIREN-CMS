/**
 * AI 답변 초안 생성 — STEP E-4b + ★ M-10 확장
 *
 * 1. generateReplyDraft        — 유가족 지원 전용 (기존)
 * 2. generateUniversalReplyDraft — 사건제보/악성민원/법률/자유게시판 통합 (NEW)
 */
import { callGemini } from "./ai-gemini";

const CATEGORY_LABEL: Record<string, string> = {
  counseling: "심리상담",
  legal: "법률자문",
  scholarship: "장학사업",
  other: "기타",
};

const CATEGORY_GUIDE: Record<string, string> = {
  counseling: "유가족 전담 임상심리사/상담사 매칭 절차 안내",
  legal: "교육 분쟁 전문 변호사 패널 매칭 절차 안내",
  scholarship: "장학금 심사 일정 및 필요 서류 안내",
  other: "담당자 검토 후 적합한 지원 프로그램 안내",
};

/* ═══════════════════════════════════════════════════
   기존: 유가족 지원 전용
   ═══════════════════════════════════════════════════ */
export interface ReplyDraftInput {
  applicantName: string;
  category: string;
  title: string;
  content: string;
  priority?: string;
  currentStatus: string;
}

export interface ReplyDraftResult {
  ok: boolean;
  draft?: string;
  error?: string;
}

export async function generateReplyDraft(
  input: ReplyDraftInput
): Promise<ReplyDraftResult> {
  const categoryKr = CATEGORY_LABEL[input.category] || input.category;
  const guide = CATEGORY_GUIDE[input.category] || "검토 후 안내";

  const systemInstruction = `당신은 교사유가족협의회 NPO의 전담 코디네이터입니다.
유가족 회원에게 따뜻하고 정중한 답변을 작성합니다.

# 작성 원칙
1. 정중하고 따뜻한 어조 (공감 + 전문성)
2. 호칭: "${input.applicantName}님"
3. 분량: 4-6문장 (너무 짧지도 길지도 않게)
4. 구조:
   - 1문장: 감사/위로 인사
   - 2-3문장: 신청 내용 확인 + 처리 방향 안내
   - 1-2문장: 다음 단계 (영업일 며칠 이내 / 추가 정보 필요 여부 등)
   - 마지막: 격려 한마디
5. 절대 금지:
   - 공허한 약속 ("반드시 해결해드리겠습니다" 등)
   - 책임 회피성 표현
   - 전문 용어 남발
6. 카테고리별 안내 포인트: ${guide}`;

  const prompt = `다음 유가족 지원 신청에 대한 관리자 답변 초안을 작성해주세요.
순수 텍스트로만 응답하세요 (마크다운/JSON 사용 금지).

# 신청 정보
- 신청자: ${input.applicantName}
- 카테고리: ${categoryKr}
- 제목: ${input.title}
- 현재 처리 상태: ${input.currentStatus}
${input.priority === "urgent" ? "- ⚠️ AI 긴급 분석: 우선 대응 필요" : ""}

# 신청 내용
${input.content.slice(0, 1500)}${input.content.length > 1500 ? "..." : ""}

# 답변 초안 (마이페이지에서 신청자가 직접 읽음):`;

  try {
    const result = await callGemini(prompt, {
      temperature: 0.6,
      maxOutputTokens: 600,
      systemInstruction,
    });

    if (!result.ok || !result.text) {
      return { ok: false, error: result.error || "AI 응답 없음" };
    }

    let draft = result.text.trim();
    draft = draft.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "");
    draft = draft.replace(/^["']|["']$/g, "");

    return { ok: true, draft };
  } catch (err: any) {
    console.error("[ai-reply] 생성 예외:", err);
    return { ok: false, error: err?.message || "Unknown error" };
  }
}

/* ═══════════════════════════════════════════════════
   ★ M-10 NEW: 사이렌 관리 통합 답변 초안 (4종 카테고리)
   ═══════════════════════════════════════════════════ */
export type UniversalCategory =
  | "incident"      // 사건 제보
  | "harassment"    // 악성민원
  | "legal"         // 법률 상담
  | "board";        // 자유게시판 (관리자 답변/공식 입장 표명)

export interface UniversalReplyInput {
  category: UniversalCategory;
  applicantName: string;
  title: string;
  contentText: string;       // HTML 제거된 평문
  aiSeverity?: string;       // 'critical'|'high'|'medium'|'low' or 'urgent'|'normal'
  aiSummary?: string;
  aiSuggestion?: string;
  currentStatus?: string;
}

const UNIVERSAL_GUIDE: Record<UniversalCategory, string> = {
  incident:   "사건 제보의 경우 — 정보 제공 감사 + 사실 확인 절차 + 추가 정보 요청 가능성 + 향후 대응 방향",
  harassment: "악성민원의 경우 — 공감 + 즉각적 대처 안내 + 법률 자문/심리지원 연결 가능성 + 운영진 지원 약속",
  legal:      "법률 상담의 경우 — 1차 자문 한계 명시 + 변호사 패널 매칭 절차 + 시효/증거보관 강조",
  board:      "자유게시판 관리자 답변의 경우 — 게시 의견 존중 + 협회 공식 입장 또는 정보 보강 + 후속 조치 안내",
};

const UNIVERSAL_TONE: Record<UniversalCategory, string> = {
  incident:   "객관적이면서도 신뢰감 있는 어조. 제보자 보호 의지 표현.",
  harassment: "깊은 공감 + 단호한 지지. 혼자가 아니라는 메시지.",
  legal:      "전문성 + 신중함. 법률 자문이 아님을 명확히.",
  board:      "정중하면서도 친근한 어조. 일방적 통보가 아닌 소통.",
};

const CATEGORY_KR_UNIVERSAL: Record<UniversalCategory, string> = {
  incident: "사건 제보",
  harassment: "악성민원 신고",
  legal: "법률 상담",
  board: "자유게시판",
};

export async function generateUniversalReplyDraft(
  input: UniversalReplyInput
): Promise<ReplyDraftResult> {
  const categoryKr = CATEGORY_KR_UNIVERSAL[input.category];
  const guide = UNIVERSAL_GUIDE[input.category];
  const tone = UNIVERSAL_TONE[input.category];

  const systemInstruction = `당신은 교사유가족협의회 "사이렌" 사이트의 운영진 코디네이터입니다.

# 어조
${tone}

# 작성 원칙
1. 호칭: "${input.applicantName}님"
2. 분량: 5-7문장 (적당한 길이)
3. 구조:
   - 인사 + 감사/공감 (1문장)
   - 신청·제보 내용 요약 확인 (1-2문장)
   - 처리 방향/입장 (2-3문장)
   - 다음 단계 안내 (1문장)
   - 격려/마무리 (1문장)
4. 카테고리별 가이드: ${guide}
5. 금지:
   - 공허한 약속 ("반드시 해결" 등)
   - 책임 회피성 표현
   - 법률 자문이라는 단정 (legal에서 특히)
   - 익명 게시자 신원 추측 (board에서)`;

  const aiContext = input.aiSeverity || input.aiSummary || input.aiSuggestion
    ? `
# 사전 AI 분석 결과
${input.aiSeverity ? `- 위급도/긴급도: ${input.aiSeverity}` : ""}
${input.aiSummary ? `- AI 요약: ${input.aiSummary}` : ""}
${input.aiSuggestion ? `- AI 권장: ${input.aiSuggestion}` : ""}
`
    : "";

  const prompt = `다음 ${categoryKr}에 대한 관리자 답변 초안을 작성해주세요.
순수 텍스트로만 응답하세요 (마크다운/JSON 사용 금지).

# 기본 정보
- 카테고리: ${categoryKr}
- 신청자: ${input.applicantName}
- 제목: ${input.title}
${input.currentStatus ? `- 현재 상태: ${input.currentStatus}` : ""}
${aiContext}

# 본문
${input.contentText.slice(0, 2000)}${input.contentText.length > 2000 ? "..." : ""}

# 답변 초안 (마이페이지에서 신청자가 직접 읽음):`;

  try {
    const result = await callGemini(prompt, {
      temperature: 0.6,
      maxOutputTokens: 800,
      systemInstruction,
    });

    if (!result.ok || !result.text) {
      return { ok: false, error: result.error || "AI 응답 없음" };
    }

    let draft = result.text.trim();
    draft = draft.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "");
    draft = draft.replace(/^["']|["']$/g, "");

    return { ok: true, draft };
  } catch (err: any) {
    console.error("[ai-reply universal] 생성 예외:", err);
    return { ok: false, error: err?.message || "Unknown error" };
  }
}