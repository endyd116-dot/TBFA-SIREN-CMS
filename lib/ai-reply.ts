/**
 * AI 답변 초안 생성 — STEP E-4b
 *
 * 신청 내용 기반으로 관리자가 보낼 답변 초안 자동 생성
 * 카테고리/내용/우선순위를 종합 고려하여 자연스러운 답변 작성
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

    /* 마크다운 잔재 제거 */
    let draft = result.text.trim();
    draft = draft.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "");
    draft = draft.replace(/^["']|["']$/g, ""); // 양쪽 따옴표 제거

    return { ok: true, draft };
  } catch (err: any) {
    console.error("[ai-reply] 생성 예외:", err);
    return { ok: false, error: err?.message || "Unknown error" };
  }
}