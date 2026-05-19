import { db } from "../../db/index";
import { workspaceTasks, attRemoteWorkReports } from "../../db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { callGemini } from "../../lib/ai-gemini";

export const config = { path: "/api/att/ai-draft" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, ...data as object }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "AI 초안 생성 실패", step,
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

  const date: string = body.date ?? new Date().toISOString().slice(0, 10);
  const memberId: number = auth.ctx.member.id;
  // att_remote_work_reports.member_uid 는 R29-ATT-GAP1 부터 varchar(36) — 문자열 변환 필요
  const memberUidStr = String(memberId);

  // 오늘 할당된 WBS 카드 수집 (assignedTo = memberId, 오늘 이후 updatedAt)
  let todayCards: any[] = [];
  try {
    const todayStart = new Date(date + "T00:00:00.000Z");
    todayCards = await db
      .select({
        id: workspaceTasks.id,
        title: workspaceTasks.title,
        status: workspaceTasks.status,
        progress: workspaceTasks.progress,
        description: workspaceTasks.description,
      })
      .from(workspaceTasks)
      .where(and(
        eq(workspaceTasks.assignedTo, memberId),
        gte(workspaceTasks.updatedAt, todayStart),
      ))
      .limit(20);
  } catch (err) {
    console.warn("[ai-draft] WBS 카드 조회 실패:", err);
  }

  // 이전 3일 보고서 수집
  let prevReports: any[] = [];
  try {
    const threeDaysAgo = new Date(date);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const since = threeDaysAgo.toISOString().slice(0, 10);

    prevReports = await db
      .select({
        date: attRemoteWorkReports.date,
        content: attRemoteWorkReports.content,
      })
      .from(attRemoteWorkReports)
      .where(and(
        eq(attRemoteWorkReports.memberUid, memberUidStr),
        gte(attRemoteWorkReports.date, since),
      ))
      .orderBy(desc(attRemoteWorkReports.date))
      .limit(3);
  } catch (err) {
    console.warn("[ai-draft] 이전 보고서 조회 실패:", err);
  }

  // 카드 목록 텍스트
  const cardList = todayCards.length > 0
    ? todayCards.map(c => `- [${c.status}] ${c.title} (진행률 ${c.progress}%)`).join("\n")
    : "오늘 작업한 카드 없음";

  // 이전 보고서 맥락 텍스트
  const prevContext = prevReports.length > 0
    ? prevReports.map(r => `[${r.date}] ${(r.content ?? "").slice(0, 200)}`).join("\n\n")
    : "이전 보고서 없음";

  const prompt = `오늘(${date}) 재택근무 일일 보고서 초안을 작성해주세요.

오늘 작업한 카드 목록:
${cardList}

이전 보고서 맥락:
${prevContext}

아래 4개 섹션으로 500자 이내 한국어 보고서 초안을 작성해주세요:
1. 오늘 한 일
2. 진행률 및 결과
3. 내일 계획
4. 이슈 및 요청사항

섹션 제목을 포함하고, 자연스럽고 구체적으로 작성하세요.`;

  try {
    const result = await callGemini(prompt, {
      featureKey: "att_remote_draft",
      mode: "flash",
      temperature: 0.7,
      maxOutputTokens: 800,
      systemInstruction: "당신은 재택근무 일일 보고서 초안 작성 도우미입니다. 500자 이내 한국어로 작성하세요.",
    });

    if (!result.ok) {
      return new Response(JSON.stringify({ ok: false, error: "AI 초안 생성 오류", step: "gemini_call" }),
        { status: 500, headers: { "Content-Type": "application/json" } });
    }

    // aiDraft 컬럼에 저장 (DRAFT 상태 유지)
    try {
      await db
        .insert(attRemoteWorkReports)
        .values({
          memberUid: memberUidStr,
          date,
          aiDraft: result.text,
          status: "DRAFT",
        })
        .onConflictDoUpdate({
          target: [attRemoteWorkReports.memberUid, attRemoteWorkReports.date],
          set: { aiDraft: result.text, updatedAt: new Date() },
        });
    } catch (err) {
      console.warn("[ai-draft] aiDraft 저장 실패:", err);
    }

    return jsonOk({ draft: result.text });
  } catch (err) {
    return jsonError("gemini_call", err);
  }
}
