import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { callGemini } from "../../lib/ai-gemini";

export const config = { path: "/api/ai-milestone-insight" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "POST만 지원합니다" }, { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try { body = await req.json(); } catch {
    return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 });
  }

  const { type, quarterId, memberId, selfEvalText } = body;
  if (!type || !["summary", "anomaly", "coach", "recommend"].includes(type)) {
    return Response.json({ ok: false, error: "type은 summary|anomaly|coach|recommend 중 하나" }, { status: 400 });
  }

  try {
    switch (type) {
      case "summary": return await handleSummary(quarterId);
      case "anomaly": return await handleAnomaly(quarterId);
      case "coach":   return await handleCoach(selfEvalText, memberId);
      case "recommend": return await handleRecommend(quarterId);
      default:
        return Response.json({ ok: false, error: "지원하지 않는 type" }, { status: 400 });
    }
  } catch (err: any) {
    return Response.json({ ok: false, error: "AI 인사이트 오류", detail: String(err?.message || err).slice(0, 300) });
  }
}

async function handleSummary(quarterId?: number) {
  if (!quarterId) return Response.json({ ok: false, error: "quarterId 필수" }, { status: 400 });

  const qRow = await db.execute(sql`SELECT year, quarter FROM quarters WHERE id = ${Number(quarterId)}`);
  const q = ((qRow as any).rows?.[0] || qRow[0]) as any;
  if (!q) return Response.json({ ok: false, error: "분기 없음" }, { status: 404 });

  const settleRows = await db.execute(sql`
    SELECT qs.total_bonus, qs.revenue_linked_total, qs.non_revenue_total,
           m.name as member_name, m.milestone_role
    FROM quarterly_settlements qs
    LEFT JOIN members m ON m.id = qs.member_id
    WHERE qs.quarter_id = ${Number(quarterId)} AND qs.status IN ('SUBMITTED','APPROVED','PAID')
  `);
  const settles = (settleRows as any).rows || (settleRows as any[]);
  if (settles.length === 0) {
    return Response.json({ ok: true, data: { text: "제출된 결산 데이터가 없습니다.", items: [] } });
  }

  const dataStr = settles.map((s: any) =>
    `${s.member_name || "?"}(${s.milestone_role}): 매출연동 ${Number(s.revenue_linked_total).toLocaleString()}원, 비매출 ${Number(s.non_revenue_total).toLocaleString()}원, 합계 ${Number(s.total_bonus).toLocaleString()}원`
  ).join("\n");

  const prompt = `${q.year}년 ${q.quarter}분기 전 직원 성과를 핵심 3줄로 요약하세요.

데이터:
${dataStr}`;

  const result = await callGemini(prompt, {
    mode: "flash", featureKey: "milestone_insight",
    systemInstruction: "NPO 조직 성과 분석 HR 어시스턴트입니다.",
    maxOutputTokens: 600,
  });

  return Response.json({
    ok: true,
    data: { text: result.text || "요약 생성 실패" },
  });
}

async function handleAnomaly(quarterId?: number) {
  // 최근 3개 분기 매출 트렌드 수집
  const recentQRows = await db.execute(sql`
    SELECT id, year, quarter FROM quarters
    WHERE status IN ('ENDED', 'SETTLED', 'ACTIVE')
    ORDER BY year DESC, quarter DESC LIMIT 3
  `);
  const recentQs = (recentQRows as any).rows || (recentQRows as any[]);
  if (recentQs.length === 0) {
    return Response.json({ ok: true, data: { text: "분기 데이터가 없습니다.", items: [] } });
  }

  const trendData: string[] = [];
  for (const q of recentQs) {
    const sumRows = await db.execute(sql`
      SELECT md.name, COALESCE(SUM(re.amount::numeric), 0) as total
      FROM revenue_entries re
      JOIN milestone_definitions md ON md.id = re.milestone_definition_id
      WHERE re.quarter_id = ${q.id} AND re.status = 'VERIFIED'
      GROUP BY md.name
      ORDER BY total DESC LIMIT 10
    `);
    const sums = (sumRows as any).rows || (sumRows as any[]);
    trendData.push(`${q.year}년 ${q.quarter}분기:\n` + sums.map((s: any) => `  ${s.name}: ${Number(s.total).toLocaleString()}원`).join("\n"));
  }

  const prompt = `최근 ${recentQs.length}개 분기 매출 트렌드를 분석하여 급증·급락 항목과 원인 가설을 3개 이내로 제시하세요.

${trendData.join("\n\n")}`;

  const result = await callGemini(prompt, {
    mode: "flash", featureKey: "milestone_insight",
    systemInstruction: "NPO 조직 성과 분석 HR 어시스턴트입니다.",
    maxOutputTokens: 800,
  });

  return Response.json({
    ok: true,
    data: { text: result.text || "이상 탐지 분석 실패" },
  });
}

async function handleCoach(selfEvalText?: string, memberId?: number) {
  if (!selfEvalText) return Response.json({ ok: false, error: "selfEvalText 필수" }, { status: 400 });

  // 달성된 마일스톤 목록
  let verifiedList = "";
  if (memberId) {
    try {
      const verRows = await db.execute(sql`
        SELECT md.name FROM non_revenue_achievements nra
        JOIN milestone_definitions md ON md.id = nra.milestone_definition_id
        WHERE nra.submitted_by = ${Number(memberId)} AND nra.status = 'VERIFIED'
        ORDER BY nra.created_at DESC LIMIT 10
      `);
      const vers = (verRows as any).rows || (verRows as any[]);
      verifiedList = vers.map((v: any) => v.name).join(", ");
    } catch { /* 보조 조회 실패 무시 */ }
  }

  const prompt = `다음 자가평가 내용에서 누락되거나 보완이 필요한 성과 항목을 안내하세요. 200자 이내.

자가평가:
${selfEvalText}
${verifiedList ? `\n달성 마일스톤: ${verifiedList}` : ""}`;

  const result = await callGemini(prompt, {
    mode: "flash", featureKey: "milestone_insight",
    systemInstruction: "NPO 조직 성과 분석 HR 어시스턴트입니다.",
    maxOutputTokens: 400,
  });

  return Response.json({
    ok: true,
    data: { text: result.text || "코칭 생성 실패" },
  });
}

async function handleRecommend(quarterId?: number) {
  // 현재 마일스톤 목록
  const mdRows = await db.execute(sql`
    SELECT name FROM milestone_definitions WHERE is_active = TRUE ORDER BY sort_order, id
  `);
  const currentMilestones = ((mdRows as any).rows || (mdRows as any[])).map((m: any) => m.name);

  // 이번 분기 달성 패턴 요약
  let achievementSummary = "";
  if (quarterId) {
    try {
      const achRows = await db.execute(sql`
        SELECT md.name, COUNT(*) as cnt
        FROM non_revenue_achievements nra
        JOIN milestone_definitions md ON md.id = nra.milestone_definition_id
        WHERE nra.quarter_id = ${Number(quarterId)} AND nra.status = 'VERIFIED'
        GROUP BY md.name ORDER BY cnt DESC LIMIT 10
      `);
      const achs = (achRows as any).rows || (achRows as any[]);
      achievementSummary = achs.map((a: any) => `${a.name}(${a.cnt}건)`).join(", ");
    } catch { /* 보조 조회 실패 무시 */ }
  }

  const prompt = `현재 분기 데이터를 바탕으로 다음 분기에 추가하면 좋을 마일스톤 3~5개를 추천하세요.

현재 마일스톤 목록:
${currentMilestones.join("\n")}
${achievementSummary ? `\n이번 분기 달성 패턴: ${achievementSummary}` : ""}

각 추천 항목을 줄바꿈으로 구분하여 간결하게 제시하세요.`;

  const result = await callGemini(prompt, {
    mode: "flash", featureKey: "milestone_insight",
    systemInstruction: "NPO 조직 성과 분석 HR 어시스턴트입니다.",
    maxOutputTokens: 600,
  });

  const text = result.text || "추천 생성 실패";
  const items = text.split("\n").map(s => s.trim()).filter(s => s.length > 5).slice(0, 5);

  return Response.json({
    ok: true,
    data: { text, items },
  });
}
