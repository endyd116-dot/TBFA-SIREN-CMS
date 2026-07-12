import { jsonKST } from "../../lib/kst";
import { db } from "../../db/index";
import { attRemoteWorkReports, attRecords, workspaceTasks } from "../../db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { callGeminiJSON } from "../../lib/ai-gemini";

export const config = { path: "/api/att/ai-insight" };

function jsonOk(data: unknown) {
  return new Response(jsonKST({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(jsonKST({
    ok: false, error: "AI 흐름파악 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { type = "remote", startDate, endDate } = body;
  // memberUid는 어드민 자신 또는 어드민이 지정한 멤버
  const memberUid: number = body.memberUid ?? auth.ctx.member.id;
  const memberId: number = memberUid;

  if (!startDate || !endDate) {
    return new Response(jsonKST({ ok: false, error: "startDate, endDate 필수", step: "validate" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // 보고서 수집
  let reports: any[] = [];
  try {
    reports = await db
      .select({
        date: attRemoteWorkReports.date,
        content: attRemoteWorkReports.content,
        qualityScore: attRemoteWorkReports.qualityScore,
        status: attRemoteWorkReports.status,
      })
      .from(attRemoteWorkReports)
      .where(and(
        eq(attRemoteWorkReports.memberUid, String(memberId)),
        gte(attRemoteWorkReports.date, startDate),
        lte(attRemoteWorkReports.date, endDate),
      ))
      .limit(30);
  } catch (err) {
    console.warn("[ai-insight] 보고서 조회 실패:", err);
  }

  // 근태 기록 수집 (type === "all"이면 추가)
  let records: any[] = [];
  if (type === "all") {
    try {
      records = await db
        .select({
          date: attRecords.date,
          workMode: attRecords.workMode,
          status: attRecords.status,
          workingMins: attRecords.workingMins,
          overtimeMins: attRecords.overtimeMins,
        })
        .from(attRecords)
        .where(and(
          eq(attRecords.memberUid, String(memberId)),
          gte(attRecords.date, startDate),
          lte(attRecords.date, endDate),
        ))
        .limit(60);
    } catch (err) {
      console.warn("[ai-insight] 근태 기록 조회 실패:", err);
    }
  }

  // WBS 진행 현황
  let wbsTasks: any[] = [];
  try {
    wbsTasks = await db
      .select({
        title: workspaceTasks.title,
        status: workspaceTasks.status,
        progress: workspaceTasks.progress,
      })
      .from(workspaceTasks)
      .where(and(
        eq(workspaceTasks.assignedTo, memberId),
        gte(workspaceTasks.updatedAt, new Date(startDate)),
        lte(workspaceTasks.updatedAt, new Date(endDate + "T23:59:59Z")),
      ))
      .limit(30);
  } catch (err) {
    console.warn("[ai-insight] WBS 조회 실패:", err);
  }

  const reportSummary = reports.length > 0
    ? reports.map(r => `[${r.date}] ${(r.content ?? "").slice(0, 300)}`).join("\n\n")
    : "보고서 없음";

  const recordSummary = records.length > 0
    ? records.map(r => `${r.date}: ${r.workMode ?? "미정"}, ${r.status}, ${r.workingMins ?? 0}분 근무`).join("\n")
    : "";

  const wbsSummary = wbsTasks.length > 0
    ? wbsTasks.map(t => `- ${t.title} [${t.status}] ${t.progress}%`).join("\n")
    : "WBS 작업 없음";

  const prompt = `${startDate} ~ ${endDate} 기간의 직원 업무 흐름을 분석해주세요.

재택근무 보고서:
${reportSummary}

${type === "all" && recordSummary ? `근태 기록:\n${recordSummary}\n\n` : ""}WBS 작업 현황:
${wbsSummary}

아래 JSON 형식으로 분석 결과를 반환하세요 (한국어):
{
  "categories": [{"name": "카테고리명", "pct": 30}],
  "pattern": "업무 패턴 설명 (200자 이내)",
  "anomalies": ["이상 신호 1", "이상 신호 2"],
  "summary": "종합 평가 (500자 이내)",
  "qualityAvg": 80
}`;

  try {
    const result = await callGeminiJSON<{
      categories: { name: string; pct: number }[];
      pattern: string;
      anomalies: string[];
      summary: string;
      qualityAvg: number;
    }>(prompt, {
      featureKey: "att_ai_insight",
      mode: "flash",
      temperature: 0.3,
      maxOutputTokens: 1000,
      systemInstruction: "NPO 직원 업무 흐름을 분석하는 HR 어시스턴트입니다. JSON만 반환하세요.",
    });

    if (!result.ok || !result.data) {
      // AI 실패 시 휴리스틱 폴백
      return jsonOk({
        summary: `${startDate} ~ ${endDate} 기간 동안 보고서 ${reports.length}건이 제출되었습니다.`,
        categories: [],
        qualityAvg: null,
        anomalies: [],
        pattern: "AI 분석을 완료하지 못했습니다.",
      });
    }

    return jsonOk(result.data);
  } catch (err) {
    return jsonError("gemini_call", err);
  }
}
