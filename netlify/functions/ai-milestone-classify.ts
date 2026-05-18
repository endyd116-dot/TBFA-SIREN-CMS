import type { Context } from "@netlify/functions";
import { requireActiveUser } from "../../lib/auth";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { callGemini } from "../../lib/ai-gemini";

export const config = { path: "/api/ai-milestone-classify" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "POST만 지원합니다" }, { status: 405 });
  }

  const auth = await requireActiveUser(req);
  if (!auth.ok) return auth.res;

  let body: any;
  try { body = await req.json(); } catch {
    return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 });
  }
  const { description, quarterId } = body;
  if (!description || !quarterId) {
    return Response.json({ ok: false, error: "description, quarterId 필수" }, { status: 400 });
  }

  try {
    // 활성 마일스톤 정의 목록 조회
    const rows = await db.execute(sql`
      SELECT id, name, category, target_milestone_role
      FROM milestone_definitions
      WHERE is_active = TRUE AND category = 'REVENUE_LINKED'
      ORDER BY sort_order, id
    `);
    const milestones = ((rows as any).rows || (rows as any[])) as Array<{
      id: number; name: string; category: string; target_milestone_role: string;
    }>;

    if (milestones.length === 0) {
      return Response.json({ ok: false, error: "활성 마일스톤 정의 없음" }, { status: 404 });
    }

    const milestoneList = milestones.map(m => `${m.id}. ${m.name} (담당: ${m.target_milestone_role})`).join("\n");

    const prompt = `다음 매출 항목을 분석하여 아래 마일스톤 중 가장 적합한 1개를 JSON으로 추천하세요.

설명: ${description}

마일스톤 목록:
${milestoneList}

응답 형식 (JSON만, 설명 없이):
{ "definitionId": number, "name": string, "confidence": 0~1, "reason": string }`;

    const result = await callGemini(prompt, {
      mode: "flash",
      featureKey: "milestone_classify",
      systemInstruction: "당신은 NPO 조직의 매출 원천 분류 전문가입니다.",
      temperature: 0.2,
      maxOutputTokens: 500,
    });

    if (!result.ok || !result.text) {
      return Response.json({ ok: false, error: "분류 실패" });
    }

    let suggestion: any;
    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("JSON 없음");
      suggestion = JSON.parse(jsonMatch[0]);
    } catch {
      return Response.json({ ok: false, error: "분류 결과 파싱 실패" });
    }

    // definitionId 유효성 검증
    const matched = milestones.find(m => m.id === Number(suggestion.definitionId));
    if (!matched) {
      return Response.json({ ok: false, error: "추천된 마일스톤 ID가 유효하지 않습니다" });
    }

    return Response.json({
      ok: true,
      suggestion: {
        definitionId: matched.id,
        name: matched.name,
        confidence: Number(suggestion.confidence ?? 0),
        reason: String(suggestion.reason ?? ""),
      },
    });
  } catch (err: any) {
    return Response.json({ ok: false, error: "분류 실패", detail: String(err?.message || err).slice(0, 300) });
  }
}
