/**
 * POST /api/admin/ai/similar-cases
 * Body: { id: number }
 * 응답: { ok, cases: [{ requestNo, title, similarity, summary, processingDays }] }
 *
 * 같은 카테고리의 완료(completed) 신청 중에서 AI가 유사한 케이스 3건 선정
 * + 처리 방법 요약 제공
 */
import { eq, and, ne, desc } from "drizzle-orm";
import { db, supportRequests } from "../../db";
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

interface SimilarCase {
  requestNo: string;
  title: string;
  similarity: number;       // 0-100
  summary: string;          // 처리 방법 요약 (50자 이내)
  processingDays: number | null;
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

    /* 현재 신청 조회 */
    const [current] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, id))
      .limit(1);

    if (!current) return notFound("신청 내역 없음");

    /* 같은 카테고리의 완료 케이스 후보 (최대 20건) */
    const candidates = await db
      .select({
        id: supportRequests.id,
        requestNo: supportRequests.requestNo,
        title: supportRequests.title,
        content: supportRequests.content,
        adminNote: supportRequests.adminNote,
        createdAt: supportRequests.createdAt,
        completedAt: supportRequests.completedAt,
      })
      .from(supportRequests)
      .where(
        and(
          eq(supportRequests.category, current.category),
          eq(supportRequests.status, "completed"),
          ne(supportRequests.id, id)
        )
      )
      .orderBy(desc(supportRequests.completedAt))
      .limit(20);

    if (candidates.length === 0) {
      return ok(
        { cases: [], message: "동일 카테고리에 완료된 사례가 없습니다" },
        "유사 사례 없음"
      );
    }

    /* AI 호출용 압축된 후보 목록 */
    const compactCandidates = candidates.map((c, i) => ({
      idx: i,
      requestNo: c.requestNo,
      title: c.title,
      contentSummary: (c.content || "").slice(0, 200),
      processingDays: c.completedAt
        ? Math.round((new Date(c.completedAt).getTime() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24))
        : null,
    }));

    const categoryKr = CATEGORY_LABEL[current.category] || current.category;

    const prompt = `당신은 NPO 지원 사업 사례 분석가입니다.
현재 신청에 가장 유사한 과거 완료 사례를 분석해주세요.

# 현재 신청
- 카테고리: ${categoryKr}
- 제목: ${current.title}
- 내용: ${current.content.slice(0, 800)}

# 과거 완료 사례 후보
${compactCandidates.map((c) =>
  `[${c.idx}] ${c.requestNo} | ${c.title}\n  내용 요약: ${c.contentSummary}\n  처리일수: ${c.processingDays !== null ? c.processingDays + "일" : "—"}`
).join("\n\n")}

# 작업
위 후보 중에서 현재 신청과 유사도가 높은 순으로 최대 3건을 선정하고,
각 사례의 핵심 처리 방향을 요약해주세요.

# 응답 형식
JSON 객체로만 응답:

{
  "cases": [
    {
      "idx": 후보의 idx 번호,
      "similarity": 0-100 사이 유사도 점수,
      "summary": "이 사례의 핵심 처리 방법을 한글 1-2문장으로 (40자 이내)"
    }
  ]
}

유사한 사례가 정말 없다면 빈 배열을 반환하세요: { "cases": [] }`;

    const result = await callGeminiJSON<{ cases: Array<{ idx: number; similarity: number; summary: string }> }>(
      prompt,
      { temperature: 0.3, maxOutputTokens: 600 }
    );

    if (!result.ok || !result.data?.cases) {
      /* AI 실패 시 단순 최신순 3건 반환 (유사도 표시 없이) */
      const fallbackCases: SimilarCase[] = candidates.slice(0, 3).map((c) => ({
        requestNo: c.requestNo,
        title: c.title,
        similarity: 0,
        summary: c.adminNote ? c.adminNote.slice(0, 60) : "처리 완료",
        processingDays: c.completedAt
          ? Math.round((new Date(c.completedAt).getTime() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24))
          : null,
      }));
      return ok({ cases: fallbackCases }, "AI 분석 실패 - 최신 완료 사례 표시");
    }

    /* AI 결과를 후보와 매핑 */
    const aiCases = result.data.cases.slice(0, 3);
    const finalCases: SimilarCase[] = [];
    for (const ai of aiCases) {
      const cand = candidates[ai.idx];
      if (!cand) continue;
      finalCases.push({
        requestNo: cand.requestNo,
        title: cand.title,
        similarity: clampScore(ai.similarity),
        summary: String(ai.summary || "").slice(0, 80),
        processingDays: cand.completedAt
          ? Math.round((new Date(cand.completedAt).getTime() - new Date(cand.createdAt).getTime()) / (1000 * 60 * 60 * 24))
          : null,
      });
    }

    return ok({ cases: finalCases }, "유사 사례를 분석했습니다");
  } catch (err) {
    console.error("[admin-ai-similar-cases]", err);
    return serverError("유사 사례 분석 중 오류", err);
  }
};

function clampScore(n: any): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export const config = { path: "/api/admin/ai/similar-cases" };