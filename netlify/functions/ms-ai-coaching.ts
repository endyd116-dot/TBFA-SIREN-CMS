/**
 * POST /api/ms-ai-coaching
 * 분기 성과 데이터 기반 200자 코칭 메시지 생성.
 *
 * body: { quarterId: number }
 * response: { ok: true, coaching: string } | { ok: false, error: string }
 */
import { jsonRes } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { callGemini } from "../../lib/ai-gemini";

export const config = { path: "/api/ms-ai-coaching" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return jsonRes({ ok: false, error: "POST만 지원합니다" }, { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const member = auth.ctx.member as any;

  let body: any;
  try { body = await req.json(); }
  catch { return jsonRes({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }

  const quarterId = Number(body?.quarterId);
  if (!quarterId) return jsonRes({ ok: false, error: "quarterId 필수" }, { status: 400 });

  try {
    /* 분기 정보 */
    const qRows = await db.execute(sql`SELECT year, quarter FROM quarters WHERE id = ${quarterId}`);
    const q = ((qRows as any).rows?.[0] || (qRows as any[])[0]) as any;
    if (!q) return jsonRes({ ok: false, error: "분기 없음" }, { status: 404 });
    const quarterLabel = `${q.year}년 Q${q.quarter}`;

    /* 본인 매출 합계 (검증 완료) */
    const rRows = await db.execute(sql`
      SELECT COALESCE(SUM(amount::numeric), 0) AS total
      FROM revenue_entries
      WHERE entered_by = ${member.id} AND quarter_id = ${quarterId} AND status = 'VERIFIED'
    `);
    const totalRevenue = Number(((rRows as any).rows?.[0] || (rRows as any[])[0])?.total || 0);

    /* 비매출 달성 건수 (검증 완료) */
    const nrRows = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt,
             COALESCE(SUM(COALESCE(event_range_amount, bonus_amount)::numeric), 0) AS bonus_sum
      FROM non_revenue_achievements
      WHERE submitted_by = ${member.id} AND quarter_id = ${quarterId} AND status = 'VERIFIED'
    `);
    const nr = ((nrRows as any).rows?.[0] || (nrRows as any[])[0]) as any;
    const nonRevenueCount = Number(nr?.cnt || 0);
    const nonRevenueBonus = Number(nr?.bonus_sum || 0);

    /* 결산 인센티브 예상 (DRAFT/SUBMITTED 등 있으면 그 값) */
    const sRows = await db.execute(sql`
      SELECT total_bonus FROM quarterly_settlements
      WHERE member_id = ${member.id} AND quarter_id = ${quarterId}
    `);
    const settle = ((sRows as any).rows?.[0] || (sRows as any[])[0]) as any;
    const incentiveTotal = Number(settle?.total_bonus || nonRevenueBonus);

    const prompt = `이 직원의 분기 성과를 보고 코칭 메시지를 200자 이내로 작성해줘.
매출합계: ${totalRevenue.toLocaleString("ko-KR")}원, 비매출달성: ${nonRevenueCount}개,
인센티브예상: ${incentiveTotal.toLocaleString("ko-KR")}원, 분기: ${quarterLabel}
강점 1가지 + 개선 방향 1가지 + 응원 문구로 마무리. 친근한 존댓말로, 이모지 1개 이내.`;

    const result = await callGemini(prompt, {
      mode: "flash",
      featureKey: "ms_ai_coaching",
      maxOutputTokens: 250,
      temperature: 0.7,
      adminId: member.id,
    });

    if (!result.ok || !result.text) {
      return jsonRes({ ok: false, error: result.error || "AI 코칭 생성 실패" });
    }

    return jsonRes({ ok: true, coaching: result.text.trim() });
  } catch (err: any) {
    console.warn("[ms-ai-coaching]", err?.message);
    return jsonRes({ ok: false, error: "AI 코칭 생성 실패" });
  }
}
