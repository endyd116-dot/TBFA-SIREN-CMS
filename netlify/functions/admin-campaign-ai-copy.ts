// netlify/functions/admin-campaign-ai-copy.ts
// ★ Phase M-19-2: AI 캠페인 카피 생성 (Gemini)
//
// POST /api/admin/campaign-ai-copy
//   body: {
//     type: 'fundraising' | 'memorial' | 'awareness',
//     theme: string,             — 캠페인 주제 (예: "교사 자녀 장학사업")
//     keywords?: string[],       — 핵심 키워드 (선택)
//     goalAmount?: number,       — 목표 금액 (fundraising용, 선택)
//     toneOfVoice?: 'warm' | 'urgent' | 'inspiring',  — 어조 (기본 'warm')
//   }
//
// 응답: { suggestedTitle, suggestedSummary, suggestedContent }
//
// 권한: super_admin 또는 donation 담당
// 비용: 회당 ~$0.001 (1500 토큰 출력)

import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { callGemini } from "../../lib/ai-gemini";
import { logAdminAction } from "../../lib/audit";

const VALID_TYPES = ["fundraising", "memorial", "awareness"];
const VALID_TONES = ["warm", "urgent", "inspiring"];

function canUseAI(adminMember: any): boolean {
  if (!adminMember) return false;
  if (adminMember.role === "super_admin") return true;
  const cats: string[] = Array.isArray(adminMember.assignedCategories) ? adminMember.assignedCategories : [];
  return cats.includes("all") || cats.includes("donation");
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member: adminMember } = guard.ctx;

  if (!canUseAI(adminMember)) {
    return forbidden("AI 카피 생성 권한이 없습니다");
  }

  try {
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const type = String(body.type || "").trim();
    const theme = String(body.theme || "").trim();
    const keywords = Array.isArray(body.keywords) ? body.keywords.slice(0, 10).map(String) : [];
    const goalAmount = Number.isFinite(Number(body.goalAmount)) ? Number(body.goalAmount) : null;
    const toneOfVoice = VALID_TONES.includes(body.toneOfVoice) ? body.toneOfVoice : "warm";

    if (!VALID_TYPES.includes(type)) return badRequest("유효하지 않은 캠페인 type");
    if (!theme || theme.length < 5) return badRequest("주제를 5자 이상 입력해주세요");
    if (theme.length > 200) return badRequest("주제는 200자 이내로 입력해주세요");

    const TYPE_DESC: any = {
      fundraising: "모금 캠페인 (목표 금액 달성을 위한 적극적 후원 유도)",
      memorial: "추모 캠페인 (고인을 기억하고 의미를 나누는 캠페인)",
      awareness: "인식 개선 캠페인 (사회적 메시지 전달과 인식 변화 유도)",
    };

    const TONE_DESC: any = {
      warm: "따뜻하고 진심 어린 어조 (위로와 공감 중심)",
      urgent: "긴급함과 절박함을 담은 어조 (즉각적 행동 유도)",
      inspiring: "희망과 변화의 가능성을 강조하는 어조 (영감 중심)",
    };

    const goalText = goalAmount
      ? `\n- 목표 금액: ${goalAmount.toLocaleString()}원`
      : "";

    const keywordsText = keywords.length > 0
      ? `\n- 핵심 키워드: ${keywords.join(", ")}`
      : "";

    const prompt = `당신은 NPO "교사유가족협의회"의 캠페인 카피라이터입니다.
다음 정보로 캠페인 카피를 작성하세요. JSON으로만 응답하세요 (코드블록 금지).

# 캠페인 정보
- 종류: ${type} — ${TYPE_DESC[type]}
- 주제: ${theme}
- 어조: ${toneOfVoice} — ${TONE_DESC[toneOfVoice]}${goalText}${keywordsText}

# 응답 형식 (JSON only)
{
  "suggestedTitle": "캠페인 제목 (40자 이내, 임팩트 있게)",
  "suggestedSummary": "한 줄 요약 (150자 이내, 카드/목록에 표시될 내용)",
  "suggestedContent": "본문 HTML (300~600자, <p>/<strong>/<br /> 사용 가능)"
}

# 작성 원칙
- 교사 유가족의 존엄과 가족의 회복을 최우선으로 존중
- 자극적/선정적 표현 금지
- 구체적 활동 (심리상담, 법률자문, 장학사업) 언급 권장
- "여러분의 작은 마음이 큰 힘이 됩니다" 같은 진솔한 표현
- ${type === "fundraising" ? "후원 행동을 자연스럽게 유도하되 강요하지 않음" : ""}
- ${type === "memorial" ? "고인의 이름이나 사건을 함부로 거론하지 않음, 추상적이고 보편적 표현" : ""}
- ${type === "awareness" ? "교권 침해/유족 회복 등 사회적 이슈를 차분히 전달" : ""}`;

    /* Gemini 호출 (JSON 응답 모드) */
    const r = await callGemini(prompt, {
      temperature: 0.8,
      maxOutputTokens: 2000,
    });

    if (!r.ok || !r.text) {
      return serverError("AI 카피 생성 실패", r.error || "응답 없음");
    }

    /* JSON 파싱 (Gemini가 종종 코드블록 감싸는 경우 처리) */
    let parsed: any = null;
    try {
      let text = r.text.trim();
      text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
      parsed = JSON.parse(text);
    } catch (e) {
      console.error("[campaign-ai-copy] JSON 파싱 실패:", r.text?.slice(0, 200));
      return serverError("AI 응답 파싱 실패 — 다시 시도해주세요");
    }

    const result = {
      suggestedTitle: String(parsed.suggestedTitle || "").slice(0, 200),
      suggestedSummary: String(parsed.suggestedSummary || "").slice(0, 500),
      suggestedContent: String(parsed.suggestedContent || "").slice(0, 5000),
    };

    if (!result.suggestedTitle || !result.suggestedSummary) {
      return serverError("AI 응답이 불완전합니다 — 다시 시도해주세요");
    }

    /* 감사 로그 */
    try {
      await logAdminAction(req, admin.uid, admin.name, "campaign_ai_copy", {
        target: theme.slice(0, 50),
        detail: { type, toneOfVoice, goalAmount, keywordCount: keywords.length },
      });
    } catch (_) {}

    return ok(result, "AI 카피가 생성되었습니다");
  } catch (err: any) {
    console.error("[admin-campaign-ai-copy]", err);
    return serverError("AI 카피 생성 중 오류", err?.message);
  }
};

export const config = { path: "/api/admin/campaign-ai-copy" };