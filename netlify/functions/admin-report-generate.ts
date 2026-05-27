/**
 * POST /api/admin-report-generate
 *
 * Phase 4 — 어드민 수동 보고서 생성 (기간 지정)
 *
 * Body: { periodStart: string (ISO), periodEnd: string (ISO), reportType?: 'custom' }
 */

import type { Context } from "@netlify/functions";
import { db, reportSnapshots, members } from "../../db";
import { eq, inArray } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { collectReportStats } from "../../lib/report-collector";
import { callGeminiJSON } from "../../lib/ai-gemini";

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    JSON.stringify({ ok: false, error: "보고서 생성 실패", step, detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 1000) }),
    { status, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

interface AiReportOutput {
  summary: string[];   // 핵심 5줄 (배열)
  alerts: Array<{ type: string; message: string; severity: "low" | "medium" | "high" }>;
}

async function generateAiSummary(stats: any): Promise<{ summary: string; alerts: any[] }> {
  const prompt = `다음은 SIREN NPO 플랫폼의 주간 통계 데이터입니다.
이 데이터를 분석하여 대표(회장)에게 보고할 핵심 요약과 위험경보를 작성해주세요.

통계 데이터:
${JSON.stringify(stats, null, 2)}

다음 JSON 형식으로만 응답하세요:
{
  "summary": ["핵심 요약 1줄", "핵심 요약 2줄", "핵심 요약 3줄", "핵심 요약 4줄", "핵심 요약 5줄"],
  "alerts": [
    { "type": "경보 유형", "message": "구체적 경보 내용", "severity": "low|medium|high" }
  ]
}

주의사항:
- summary는 정확히 5줄. 각 줄은 한 문장으로 핵심만.
- alerts는 실제 주의가 필요한 항목만. 없으면 빈 배열.
- severity: high=즉각 조치 필요, medium=모니터링 필요, low=참고사항.
- 한국어로만 작성.`;

  const result = await callGeminiJSON<AiReportOutput>(prompt, { maxOutputTokens: 2000, featureKey: "report_ai_summary" });
  if (!result.ok || !result.data) {
    const s = stats as any;
    return {
      summary: [
        `이번 기간 신규 회원 ${s.members?.newThisPeriod ?? 0}명 가입`,
        `후원 완료 ${s.donations?.count ?? 0}건, 총 ${(s.donations?.totalAmount ?? 0).toLocaleString()}원`,
        `SIREN 신고 신규 사건 ${s.siren?.incident?.newThisPeriod ?? 0}건 접수`,
        `전문가 매칭 진행중 ${s.expertMatches?.active ?? 0}건`,
        `유족지원 신규 신청 ${s.support?.newThisPeriod ?? 0}건`,
      ].join("\n"),
      alerts: [],
    };
  }
  return {
    summary: Array.isArray(result.data.summary) ? result.data.summary.join("\n") : String(result.data.summary),
    alerts: result.data.alerts ?? [],
  };
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
  }
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "POST only" }), { status: 405, headers: { "Content-Type": "application/json; charset=utf-8" } });

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  const adminMemberId = (auth as any).ctx?.member?.id ?? null;

  let body: any;
  try { body = await req.json(); } catch (err) { return jsonError("parse_body", err, 400); }

  const periodStart = body.periodStart ? new Date(body.periodStart) : null;
  const periodEnd   = body.periodEnd   ? new Date(body.periodEnd)   : null;
  if (!periodStart || isNaN(periodStart.getTime())) return new Response(JSON.stringify({ ok: false, error: "periodStart 필요 (ISO 날짜)" }), { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } });
  if (!periodEnd   || isNaN(periodEnd.getTime()))   return new Response(JSON.stringify({ ok: false, error: "periodEnd 필요 (ISO 날짜)" }), { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } });

  // ★ R41 Q2-034: 기간 논리·상한 검증 — 종료일이 시작일보다 이후여야 하고, 과도한 기간(1100일 초과) 금지
  if (periodEnd.getTime() <= periodStart.getTime()) {
    return new Response(JSON.stringify({ ok: false, error: "종료일은 시작일보다 이후여야 합니다" }), { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
  const MAX_RANGE_DAYS = 1100;
  const rangeDays = (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24);
  if (rangeDays > MAX_RANGE_DAYS) {
    return new Response(JSON.stringify({ ok: false, error: `보고 기간이 너무 깁니다 (최대 ${MAX_RANGE_DAYS}일)` }), { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  /* 통계 수집 */
  let stats;
  try { stats = await collectReportStats(periodStart, periodEnd); } catch (err) { return jsonError("collect_stats", err); }

  /* AI 요약 */
  let aiSummary = "";
  let aiAlerts: any[] = [];
  try {
    const ai = await generateAiSummary(stats);
    aiSummary = ai.summary;
    aiAlerts  = ai.alerts;
  } catch (err) { console.warn("[admin-report-generate] AI 실패, 폴백 사용", err); }

  /* INSERT */
  let insertedId: number;
  try {
    const inserted = await db.insert(reportSnapshots).values({
      reportType:  "custom",
      periodStart,
      periodEnd,
      stats:       stats as any,
      aiSummary:   aiSummary || null,
      aiAlerts:    aiAlerts as any,
      generatedBy: adminMemberId,
    } as any).returning({ id: reportSnapshots.id });
    insertedId = inserted[0]?.id;
    if (!insertedId) throw new Error("INSERT returning 비어있음");
  } catch (err) { return jsonError("insert_report", err); }

  return new Response(
    JSON.stringify({ ok: true, message: "보고서 생성 완료", data: { reportId: insertedId, periodStart, periodEnd } }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};

export const config = { path: "/api/admin-report-generate" };
