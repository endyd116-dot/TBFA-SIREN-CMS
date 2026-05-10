/**
 * POST /api/admin-ai-expert-recommend
 * 사건/상담 내용 기반 AI 전문가 추천 순위 반환
 *
 * Body: { sourceType: "incident"|"harassment"|"legal"|"support", sourceId: number, matchType: "lawyer"|"counselor" }
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";
import { callGeminiJSON } from "../../lib/ai-gemini";

export const config = { path: "/api/admin-ai-expert-recommend" };

interface AiRecommendItem {
  expertId: number;
  score: number;
  reason: string;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  let step = "parse";
  try {
    const body = await parseJson(req);

    step = "validate";
    const sourceType = String(body?.sourceType || "");
    const sourceId   = Number(body?.sourceId);
    const matchType  = String(body?.matchType || "");

    if (!sourceType) return badRequest("sourceType이 필요합니다");
    if (!Number.isFinite(sourceId) || sourceId <= 0) return badRequest("유효한 sourceId가 필요합니다");
    if (!matchType) return badRequest("matchType이 필요합니다");

    // 소스 내용 조회 (sourceType별 테이블)
    step = "select_source";
    let title = "";
    let contentText = "";
    let aiSummary = "";

    const tableMap: Record<string, string> = {
      incident:   "incident_reports",
      harassment: "harassment_reports",
      legal:      "legal_reports",
      support:    "support_requests",
    };
    const tableName = tableMap[sourceType];

    if (tableName) {
      const result = await db.execute(sql.raw(`
        SELECT title, content, ai_summary
        FROM ${tableName}
        WHERE id = ${sourceId}
        LIMIT 1
      `));
      const r = ((result as any).rows || result as any[])[0];
      if (r) {
        title      = r.title ?? "";
        contentText = r.content ?? "";
        aiSummary  = r.ai_summary ?? "";
      }
    }

    // 전문가 목록 조회 (volunteer + matchType + is_accepting_case)
    step = "select_experts";
    const expertRows = await db.execute(sql`
      SELECT
        m.id,
        m.name,
        m.member_subtype AS "memberSubtype",
        ep.specialties,
        ep.languages,
        ep.available_days  AS "availableDays",
        ep.available_hours AS "availableHours",
        ep.bio,
        ep.avg_rating      AS "avgRating",
        ep.rating_count    AS "ratingCount",
        ep.is_accepting_case AS "isAcceptingCase"
      FROM members m
      LEFT JOIN expert_profiles ep ON ep.member_id = m.id
      WHERE m.type = 'volunteer'
        AND m.member_subtype = ${matchType}
        AND m.status = 'active'
        AND (ep.is_accepting_case IS NULL OR ep.is_accepting_case = TRUE)
      ORDER BY ep.avg_rating DESC NULLS LAST
    `);

    const experts = ((expertRows as any).rows || expertRows as any[]).map((r: any) => ({
      id:             r.id,
      name:           r.name,
      memberSubtype:  r.memberSubtype,
      specialties:    safeParseJson(r.specialties),
      languages:      safeParseJson(r.languages),
      availableDays:  r.availableDays ?? "",
      availableHours: r.availableHours ?? "",
      bio:            r.bio ?? "",
      avgRating:      r.avgRating != null ? Number(r.avgRating) : 0,
      ratingCount:    r.ratingCount ?? 0,
      isAcceptingCase: r.isAcceptingCase !== false,
    }));

    if (experts.length === 0) {
      return ok({ recommendations: [] });
    }

    // Gemini 추천
    step = "ai_recommend";
    const contentSnippet = aiSummary || contentText.slice(0, 300);

    const prompt = `당신은 법률·심리상담 전문가 매칭 보조 시스템입니다.
아래 사건 내용과 전문가 목록을 보고, 각 전문가의 적합도 점수(0~100)와 한 줄 추천 이유를 JSON으로 반환하세요.

[사건 내용]
제목: ${title || "(제목 없음)"}
요약: ${contentSnippet || "(내용 없음)"}

[전문가 목록]
${experts.map((e) => `ID:${e.id} 이름:${e.name} 전문분야:${e.specialties.join(",") || "미입력"} 언어:${e.languages.join(",") || "한국어"} 가용:${e.availableDays} ${e.availableHours} 평점:${e.avgRating}(${e.ratingCount}건) 소개:${e.bio || "프로필 미입력"}`).join("\n")}

응답 형식 (JSON array only, 다른 텍스트 없이):
[
  { "expertId": 숫자, "score": 숫자, "reason": "한 줄 추천 이유" }
]`;

    const aiResult = await callGeminiJSON<AiRecommendItem[]>(prompt, {
      temperature: 0.3,
      maxOutputTokens: 800,
      mode: "flash",
    });

    step = "map";
    let scoreMap: Map<number, { score: number; reason: string }> = new Map();

    if (aiResult.ok && Array.isArray(aiResult.data)) {
      for (const item of aiResult.data) {
        const id = Number(item.expertId);
        if (Number.isFinite(id)) {
          scoreMap.set(id, {
            score:  Math.max(0, Math.min(100, Math.round(Number(item.score) || 0))),
            reason: String(item.reason || "").slice(0, 100),
          });
        }
      }
    }

    // AI 실패 또는 파싱 실패 시 avgRating 순 fallback
    const recommendations = experts
      .map((e) => {
        const ai = scoreMap.get(e.id);
        return {
          expertId:       e.id,
          name:           e.name,
          memberSubtype:  e.memberSubtype,
          score:          ai ? ai.score : Math.round(e.avgRating * 20),
          reason:         ai ? ai.reason : `평점 ${e.avgRating.toFixed(1)}점 (${e.ratingCount}건)`,
          specialties:    e.specialties,
          avgRating:      e.avgRating,
          ratingCount:    e.ratingCount,
          availableDays:  e.availableDays,
          isAcceptingCase: e.isAcceptingCase,
        };
      })
      .sort((a, b) => b.score - a.score);

    return ok({ recommendations });
  } catch (err: any) {
    return serverError(`AI 전문가 추천 실패 [${step}]`, err);
  }
};

function safeParseJson(val: any): any[] {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return []; }
}
