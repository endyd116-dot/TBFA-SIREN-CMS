/**
 * POST /api/admin/ai/expert-match
 * Body: { id: number }   (지원 신청 ID)
 * 응답: { ok, recommendations: [{ name, role, score, reason, available }] }
 *
 * Gemini가 신청 카테고리/내용을 분석하여 적합한 전문가 3명 추천
 * (실제 전문가 DB는 추후 연동 — 현재는 AI가 가상의 적합 프로필 생성)
 */
import { eq } from "drizzle-orm";
import { db, supportRequests, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { callGeminiJSON } from "../../lib/ai-gemini";

const CATEGORY_LABEL: Record<string, string> = {
  counseling: "심리상담",
  legal: "법률자문",
  scholarship: "장학사업",
  other: "기타",
};

interface ExpertRec {
  name: string;
  role: string;
  score: number;       // 0-100
  reason: string;      // 추천 이유 1-2문장
  specialty: string;   // 전문 분야 한 줄
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;

  try {
    const body = await parseJson(req);
    if (!body?.id) return badRequest("id가 필요합니다");

    const id = Number(body.id);
    if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

    /* 신청 조회 */
    const [request] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, id))
      .limit(1);

    if (!request) return notFound("신청 내역 없음");

    /* 신청자 정보 */
    const [member] = await db
      .select({ name: members.name })
      .from(members)
      .where(eq(members.id, request.memberId))
      .limit(1);

    const categoryKr = CATEGORY_LABEL[request.category] || request.category;

    /* AI 호출 */
    const prompt = `당신은 교사유가족협의회의 전문가 매칭 코디네이터입니다.
아래 지원 신청에 가장 적합한 전문가 3명을 가상으로 프로필링하여 추천해주세요.
실제 데이터베이스가 아니라 신청 내용에 맞는 "이상적인 전문가 프로필"을 생성하는 것입니다.

# 신청 정보
- 카테고리: ${categoryKr}
- 제목: ${request.title}
- 내용: ${request.content.slice(0, 1200)}${request.content.length > 1200 ? "..." : ""}
${request.priority === "urgent" ? "- ⚠️ 긴급 사안: 빠른 대응 가능한 전문가 우선" : ""}

# 추천 기준
1. 카테고리에 맞는 직역(상담사/변호사/사회복지사 등)
2. 신청 내용의 구체적 사안 (예: 청소년/유족연금/교권침해 등)에 적합한 세부 전문성
3. 각 전문가는 서로 다른 강점을 가지도록 다양화

# 응답 형식
JSON 객체로만 응답하세요. 다른 설명 없이 JSON만:

{
  "recommendations": [
    {
      "name": "한글 이름 (실명 아닌 가상 이름, 예: 박**)",
      "role": "직역 (예: 임상심리사 / 변호사 / 사회복지사)",
      "score": 0-100 사이 매칭 점수,
      "specialty": "전문 분야 한 줄 (15자 이내)",
      "reason": "이 신청에 적합한 이유 (한글 1-2문장, 50자 이내)"
    }
    // 총 3명
  ]
}`;

    const result = await callGeminiJSON<{ recommendations: ExpertRec[] }>(prompt, {
      temperature: 0.7,
      maxOutputTokens: 700,
    });

    if (!result.ok || !result.data?.recommendations) {
      /* 폴백: 카테고리 기반 기본 추천 */
      return ok(
        { recommendations: fallbackByCategory(request.category) },
        "AI 호출 실패로 기본 추천을 표시합니다"
      );
    }

    /* 정규화 (점수 범위, 길이 등) */
    const recs = (result.data.recommendations || [])
      .slice(0, 3)
      .map((r) => ({
        name: String(r.name || "전문가").slice(0, 20),
        role: String(r.role || "—").slice(0, 30),
        score: clampScore(r.score),
        specialty: String(r.specialty || "—").slice(0, 30),
        reason: String(r.reason || "").slice(0, 100),
      }));

    return ok({ recommendations: recs }, "추천 전문가가 생성되었습니다");
  } catch (err) {
    console.error("[admin-ai-expert-match]", err);
    return serverError("AI 매칭 중 오류", err);
  }
};

function clampScore(n: any): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 75;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function fallbackByCategory(category: string): ExpertRec[] {
  const map: Record<string, ExpertRec[]> = {
    counseling: [
      { name: "박**", role: "임상심리사", score: 90, specialty: "유족 트라우마 회복", reason: "유가족 심리 회복 분야 12년 경력" },
      { name: "정**", role: "상담심리사", score: 85, specialty: "청소년·가족 상담", reason: "비대면 상담 가능, 가용시간 일치" },
      { name: "이**", role: "정신건강사회복지사", score: 80, specialty: "위기 개입", reason: "긴급 사안 대응 경험 풍부" },
    ],
    legal: [
      { name: "김**", role: "변호사", score: 92, specialty: "교권/공무원연금", reason: "교사 관련 분쟁 전문" },
      { name: "최**", role: "변호사", score: 86, specialty: "유족 연금·산재", reason: "유가족 권익 보호 다수 진행" },
      { name: "윤**", role: "노무사", score: 78, specialty: "공무상 재해 인정", reason: "공무원 재해 신청 절차 전문" },
    ],
    scholarship: [
      { name: "장**", role: "교육복지사", score: 88, specialty: "학업 지원 코칭", reason: "장학생 멘토링 운영 경력" },
      { name: "한**", role: "사회복지사", score: 82, specialty: "교육비 지원 연계", reason: "지자체 장학 연계 가능" },
      { name: "오**", role: "진로상담사", score: 76, specialty: "진로·학습 설계", reason: "고교/대학 진학 컨설팅" },
    ],
    other: [
      { name: "전**", role: "사회복지사", score: 80, specialty: "통합 사례관리", reason: "다양한 지원 분야 매칭 가능" },
      { name: "송**", role: "코디네이터", score: 75, specialty: "유관기관 연계", reason: "외부 기관 자원 연결" },
      { name: "안**", role: "상담사", score: 70, specialty: "초기 면담", reason: "사안 파악 후 적합 전문가 재배정" },
    ],
  };
  return map[category] || map.other;
}

export const config = { path: "/api/admin/ai/expert-match" };