/**
 * cron-att-ai-daily: AI 일일 근태 요약 발송 (KST 18:00 = UTC 09:00)
 * schedule: 0 9 * * *
 *
 * 동작:
 * 1. 오늘 전직원 근태 데이터 수집 (출근/퇴근/재택보고서 제출 현황)
 * 2. Gemini로 "오늘 전직원 근태 요약 + 이상 신호" 생성
 * 3. 슈퍼어드민에게 인앱 알림 발송
 */

import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members, attRecords, attRemoteWorkReports } from "../../db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { callGemini } from "../../lib/ai-gemini";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

export const config = { schedule: "0 9 * * *" };

function kstToday(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export default async (_req: Request, _ctx: Context) => {
  const start = Date.now();
  const today = kstToday();
  console.info("[cron-att-ai-daily] 시작", today);

  try {
    // 오늘 근태 통계 수집
    const statsRows: any = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE check_in_time IS NOT NULL) AS checked_in,
        COUNT(*) FILTER (WHERE check_out_time IS NOT NULL) AS checked_out,
        COUNT(*) FILTER (WHERE check_in_time IS NULL) AS absent,
        COUNT(*) FILTER (WHERE work_mode = 'REMOTE') AS remote_count,
        COUNT(*) FILTER (WHERE status = 'LATE') AS late_count,
        COUNT(*) FILTER (WHERE status = 'EARLY_LEAVE') AS early_leave_count,
        COALESCE(AVG(working_mins) FILTER (WHERE working_mins IS NOT NULL), 0) AS avg_working_mins
      FROM att_records
      WHERE date = ${today}::date
    `);
    const stats = (Array.isArray(statsRows) ? statsRows[0] : ((statsRows as any).rows ?? [])[0]) ?? {};

    // 재택 보고서 제출 현황
    const reportRows: any = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'SUBMITTED') AS submitted,
        COUNT(*) AS total
      FROM att_remote_work_reports
      WHERE date = ${today}::date
    `);
    const reportStats = (Array.isArray(reportRows) ? reportRows[0] : ((reportRows as any).rows ?? [])[0]) ?? {};

    // 운영자 전체 수
    const totalOps: any = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM members
      WHERE operator_active = true AND withdrawn_at IS NULL
    `);
    const totalCount = parseInt((Array.isArray(totalOps) ? totalOps[0] : ((totalOps as any).rows ?? [])[0])?.cnt ?? "0");

    const checkedIn = parseInt(stats.checked_in ?? "0");
    const checkedOut = parseInt(stats.checked_out ?? "0");
    const absent = totalCount - checkedIn;
    const lateCount = parseInt(stats.late_count ?? "0");
    const earlyLeave = parseInt(stats.early_leave_count ?? "0");
    const remoteCount = parseInt(stats.remote_count ?? "0");
    const avgMins = Math.round(parseFloat(stats.avg_working_mins ?? "0"));
    const submitted = parseInt(reportStats.submitted ?? "0");
    const reportTotal = parseInt(reportStats.total ?? "0");

    const prompt = `${today} 근태 현황을 200자 이내로 요약하고, 이상 신호가 있으면 강조해주세요.

데이터:
- 전체 운영자: ${totalCount}명
- 출근: ${checkedIn}명, 결근/미체크: ${absent}명
- 퇴근 완료: ${checkedOut}명, 조퇴: ${earlyLeave}명
- 지각: ${lateCount}명
- 재택: ${remoteCount}명 (보고서 제출: ${submitted}/${reportTotal})
- 평균 근무시간: ${Math.floor(avgMins / 60)}시간 ${avgMins % 60}분

이상 신호 기준: 결근 20%+ / 지각 30%+ / 평균근무 6시간 미만.
한국어로 작성하고, 이상 신호 있으면 "⚠️" 표시.`;

    let summaryText = `${today} 근태: 출근 ${checkedIn}명, 결근 ${absent}명, 지각 ${lateCount}명. 재택 보고서 ${submitted}/${reportTotal} 제출.`;

    try {
      const result = await callGemini(prompt, {
        featureKey: "att_ai_daily_summary",
        mode: "flash",
        temperature: 0.3,
        maxOutputTokens: 400,
        systemInstruction: "NPO 근태 관리 비서입니다. 간결하게 요약하세요.",
      });
      if (result.ok && result.text) {
        summaryText = result.text.slice(0, 500);
      }
    } catch (err) {
      console.warn("[cron-att-ai-daily] Gemini 호출 실패, 폴백 사용:", err);
    }

    // 슈퍼어드민 알림 발송
    const superAdmins = await db
      .select({ id: members.id })
      .from(members)
      .where(and(
        eq(members.role as any, "super_admin"),
        eq(members.operatorActive as any, true),
        isNull(members.withdrawnAt),
      ))
      .limit(10);

    for (const sa of superAdmins) {
      try {
        await sendWorkspaceNotification({
          memberId: sa.id,
          sourceType: "event" as any,
          sourceId: 0,
          notifType: "reminder_3d" as any,
          channel: "bell" as any,
          title: `[AI 근태요약] ${today}`,
          body: summaryText,
          // R34-P2 (round2 M10): AI 근태요약 → 근태 현황 탭
          actionUrl: "/admin-workspace-management.html",
          category: "system" as any,
        });
      } catch (err) {
        console.warn(`[cron-att-ai-daily] 알림 실패 memberId=${sa.id}:`, err);
      }
    }

    const durationMs = Date.now() - start;
    console.info(`[cron-att-ai-daily] 완료 (${durationMs}ms)`);

    return new Response(JSON.stringify({
      ok: true, today, checkedIn, absent, summaryText, durationMs,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[cron-att-ai-daily] 오류:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message ?? err) }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
