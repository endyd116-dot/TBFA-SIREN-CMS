/**
 * Phase 3 Step 5 — Agent-8 일일 브리핑 자동 생성 cron
 *
 * 매일 KST 06:00 (UTC 21:00) 실행
 *
 * 동작:
 *   1. 활성 admin/super_admin 멤버 조회
 *   2. 멤버별:
 *      a. 통계 수집 (admin-daily-briefing의 stats=1 SQL 재사용)
 *      b. AI(Gemini Flash)에 한 줄 요약 + 우선순위 추천 + 위험 알림 요청
 *      c. daily_briefings UPSERT (uniqueIndex: memberId, briefingDate)
 *   3. 멤버별 격리 — 한 명 실패해도 다음 진행
 *   4. AI 실패 시 폴백 — 데이터 기반 단순 요약
 */

import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members, dailyBriefings } from "../../db/schema";
import { and, sql, isNull, inArray } from "drizzle-orm";
import { callGeminiJSON } from "../../lib/ai-gemini";
// ★ Phase 8: 통합 알림 디스패처 (어드민 일일 브리핑 이메일)
import { dispatch } from "../../lib/notify-dispatcher";
import { NotifyEvent } from "../../lib/notify-events";

interface BriefingStats {
  overdueCount: number;
  todayDueCount: number;
  tomorrowDueCount: number;
  inProgressCount: number;
  urgentCount: number;
  inboxCount: number;
  completedYesterdayCount: number;
  todayEventsCount: number;
  unreadNotifCount: number;
}

interface AiBriefingOutput {
  summaryMd: string;
  aiSuggestions: Array<{ title: string; reason: string; severity?: string }>;
  riskAlerts: Array<{ type: string; message: string; severity?: string }>;
}

function kstTimes() {
  const now = new Date();
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffsetMs);
  const kstToday = new Date(kstNow);
  kstToday.setHours(0, 0, 0, 0);
  const kstTomorrow = new Date(kstToday);
  kstTomorrow.setDate(kstTomorrow.getDate() + 1);
  const kstDayAfter = new Date(kstTomorrow);
  kstDayAfter.setDate(kstDayAfter.getDate() + 1);
  const kstYesterday = new Date(kstToday);
  kstYesterday.setDate(kstYesterday.getDate() - 1);
  return { kstToday, kstTomorrow, kstDayAfter, kstYesterday };
}

async function collectStats(meId: number, t: ReturnType<typeof kstTimes>): Promise<BriefingStats> {
  const stats: any = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE (member_id=${meId} OR assigned_to=${meId}) AND status!='done' AND due_date < now()) AS overdue,
      COUNT(*) FILTER (WHERE (member_id=${meId} OR assigned_to=${meId}) AND status!='done' AND due_date >= ${t.kstToday.toISOString()} AND due_date < ${t.kstTomorrow.toISOString()}) AS today_due,
      COUNT(*) FILTER (WHERE (member_id=${meId} OR assigned_to=${meId}) AND status!='done' AND due_date >= ${t.kstTomorrow.toISOString()} AND due_date < ${t.kstDayAfter.toISOString()}) AS tomorrow_due,
      COUNT(*) FILTER (WHERE (member_id=${meId} OR assigned_to=${meId}) AND status='doing') AS in_progress,
      COUNT(*) FILTER (WHERE (member_id=${meId} OR assigned_to=${meId}) AND priority='urgent' AND status!='done') AS urgent,
      COUNT(*) FILTER (WHERE assigned_to=${meId} AND assigned_by IS NOT NULL AND status='todo') AS inbox,
      COUNT(*) FILTER (WHERE completed_by=${meId} AND completed_at >= ${t.kstYesterday.toISOString()} AND completed_at < ${t.kstToday.toISOString()}) AS completed_yesterday
    FROM workspace_tasks
  `);
  const row = (Array.isArray(stats) ? stats[0] : (stats as any).rows?.[0]) || {};

  const eventStats: any = await db.execute(sql`
    SELECT COUNT(*) AS today_events
    FROM workspace_events
    WHERE (member_id=${meId} OR attendees @> ${JSON.stringify([{ memberId: meId }])}::jsonb)
      AND start_at >= ${t.kstToday.toISOString()}
      AND start_at < ${t.kstTomorrow.toISOString()}
  `);
  const evRow = (Array.isArray(eventStats) ? eventStats[0] : (eventStats as any).rows?.[0]) || {};

  const unreadNotifStats: any = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM workspace_notifications
    WHERE member_id=${meId} AND read_at IS NULL
  `);
  const notifRow = (Array.isArray(unreadNotifStats) ? unreadNotifStats[0] : (unreadNotifStats as any).rows?.[0]) || {};

  return {
    overdueCount: Number(row.overdue || 0),
    todayDueCount: Number(row.today_due || 0),
    tomorrowDueCount: Number(row.tomorrow_due || 0),
    inProgressCount: Number(row.in_progress || 0),
    urgentCount: Number(row.urgent || 0),
    inboxCount: Number(row.inbox || 0),
    completedYesterdayCount: Number(row.completed_yesterday || 0),
    todayEventsCount: Number(evRow.today_events || 0),
    unreadNotifCount: Number(notifRow.cnt || 0),
  };
}

function fallbackBriefing(memberName: string, s: BriefingStats): AiBriefingOutput {
  const lines: string[] = [`**${memberName}님, 좋은 아침입니다.**`];
  const totalAttention = s.overdueCount + s.todayDueCount + s.urgentCount;
  if (totalAttention === 0 && s.todayEventsCount === 0) {
    lines.push("\n오늘은 비교적 여유로운 하루입니다. 진행 중 작업을 마무리하기 좋은 날이에요.");
  } else {
    if (s.overdueCount > 0) lines.push(`- 지연 작업 **${s.overdueCount}건** 우선 처리 권장`);
    if (s.urgentCount > 0) lines.push(`- 긴급 표시 **${s.urgentCount}건** 대기 중`);
    if (s.todayDueCount > 0) lines.push(`- 오늘 마감 **${s.todayDueCount}건**`);
    if (s.todayEventsCount > 0) lines.push(`- 오늘 일정 **${s.todayEventsCount}건**`);
    if (s.inboxCount > 0) lines.push(`- 새로 지시받은 작업 **${s.inboxCount}건** 확인 필요`);
  }
  const riskAlerts: AiBriefingOutput["riskAlerts"] = [];
  if (s.overdueCount > 0) {
    riskAlerts.push({
      type: "overdue",
      message: `지연 작업 ${s.overdueCount}건이 누적되어 있습니다.`,
      severity: s.overdueCount > 5 ? "high" : "medium",
    });
  }
  if (s.urgentCount > 0) {
    riskAlerts.push({
      type: "urgent",
      message: `긴급 작업 ${s.urgentCount}건이 대기 중입니다.`,
      severity: "high",
    });
  }
  return {
    summaryMd: lines.join("\n"),
    aiSuggestions: [],
    riskAlerts,
  };
}

async function generateBriefing(memberName: string, s: BriefingStats): Promise<AiBriefingOutput> {
  const prompt = `당신은 ${memberName} 어드민의 업무 비서 Agent-8입니다.
오늘 아침 6시 브리핑을 작성하세요.

# 데이터
- 지연 작업: ${s.overdueCount}건
- 오늘 마감: ${s.todayDueCount}건
- 내일 마감: ${s.tomorrowDueCount}건
- 진행 중: ${s.inProgressCount}건
- 긴급: ${s.urgentCount}건
- 지시받은 새 작업: ${s.inboxCount}건
- 어제 완료: ${s.completedYesterdayCount}건
- 오늘 일정: ${s.todayEventsCount}건
- 안 읽은 알림: ${s.unreadNotifCount}건

# 응답 형식 (JSON only, 설명 금지)
{
  "summaryMd": "마크다운 한두 단락. ${memberName}님께 호칭. 어조: 차분/격려.",
  "aiSuggestions": [
    {"title": "추천 1줄 (30자 이내)", "reason": "근거 1줄 (40자 이내)", "severity": "high|medium|low"}
  ],
  "riskAlerts": [
    {"type": "overdue|urgent|notif", "message": "위험 1줄", "severity": "high|medium|low"}
  ]
}

규칙:
- aiSuggestions는 1~3개, 가장 시급한 것부터
- riskAlerts는 0~3개, 지연/긴급 있을 때만
- 모든 데이터가 0이면 summaryMd만 짧게(여유로운 하루) + suggestions/alerts 빈 배열`;

  try {
    const result = await callGeminiJSON<AiBriefingOutput>(prompt, {
      mode: "flash",
      temperature: 0.4,
      maxOutputTokens: 1500,
      featureKey: "daily_briefing_generation",
    });
    if (result.ok && result.data) {
      return {
        summaryMd: String(result.data.summaryMd || `${memberName}님, 좋은 아침입니다.`).slice(0, 2000),
        aiSuggestions: Array.isArray(result.data.aiSuggestions)
          ? result.data.aiSuggestions.slice(0, 3).map(x => ({
              title: String(x?.title || "").slice(0, 60),
              reason: String(x?.reason || "").slice(0, 100),
              severity: ["high", "medium", "low"].includes(x?.severity || "") ? x.severity : "medium",
            })).filter(x => x.title)
          : [],
        riskAlerts: Array.isArray(result.data.riskAlerts)
          ? result.data.riskAlerts.slice(0, 3).map(x => ({
              type: String(x?.type || "info").slice(0, 30),
              message: String(x?.message || "").slice(0, 200),
              severity: ["high", "medium", "low"].includes(x?.severity || "") ? x.severity : "medium",
            })).filter(x => x.message)
          : [],
      };
    }
  } catch (err) {
    console.error("[agent-8] AI 호출 예외:", err);
  }
  return fallbackBriefing(memberName, s);
}

async function processOneMember(memberId: number, memberName: string, briefingDate: Date): Promise<{ ok: boolean; error?: string }> {
  try {
    const t = kstTimes();
    const stats = await collectStats(memberId, t);
    const ai = await generateBriefing(memberName || `회원 #${memberId}`, stats);

    await db.insert(dailyBriefings).values({
      memberId,
      briefingDate,
      urgentCount: stats.urgentCount,
      todayDueCount: stats.todayDueCount,
      tomorrowDueCount: stats.tomorrowDueCount,
      newAssignments: stats.inboxCount,
      overdueCount: stats.overdueCount,
      inProgressCount: stats.inProgressCount,
      completedYesterdayCount: stats.completedYesterdayCount,
      todayEventsCount: stats.todayEventsCount,
      riskAlerts: ai.riskAlerts as any,
      aiSuggestions: ai.aiSuggestions as any,
      summaryMd: ai.summaryMd,
    } as any).onConflictDoUpdate({
      target: [dailyBriefings.memberId, dailyBriefings.briefingDate],
      set: {
        urgentCount: stats.urgentCount,
        todayDueCount: stats.todayDueCount,
        tomorrowDueCount: stats.tomorrowDueCount,
        newAssignments: stats.inboxCount,
        overdueCount: stats.overdueCount,
        inProgressCount: stats.inProgressCount,
        completedYesterdayCount: stats.completedYesterdayCount,
        todayEventsCount: stats.todayEventsCount,
        riskAlerts: ai.riskAlerts as any,
        aiSuggestions: ai.aiSuggestions as any,
        summaryMd: ai.summaryMd,
        readAt: null,
      } as any,
    });
    /* Phase 8 — 어드민 일일 브리핑 이메일 발송 (통합 디스패처)
       정책: ADMIN_DAILY_BRIEFING = ['email'] (인앱은 daily_briefings UPSERT로 이미 표시)
       fire-and-forget — 발송 실패는 dispatch_logs에 기록되며 cron-notification-retry가 처리 */
    const briefingDateStr =
      `${briefingDate.getFullYear()}-${String(briefingDate.getMonth() + 1).padStart(2, "0")}-${String(briefingDate.getDate()).padStart(2, "0")}`;
    const emailBody = (ai.summaryMd || "")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br/>");
    const suggestionsHtml = ai.aiSuggestions.length
      ? `<h3 style="margin-top:24px">우선순위 추천</h3><ul>${ai.aiSuggestions
          .map(s => `<li><strong>${s.title}</strong> — ${s.reason}</li>`)
          .join("")}</ul>`
      : "";
    const alertsHtml = ai.riskAlerts.length
      ? `<h3 style="margin-top:24px;color:#c0392b">위험 알림</h3><ul>${ai.riskAlerts
          .map(a => `<li>[${a.severity || "medium"}] ${a.message}</li>`)
          .join("")}</ul>`
      : "";

    dispatch({
      event: NotifyEvent.ADMIN_DAILY_BRIEFING,
      target: { type: "admin", id: memberId },
      params: {
        title:        `[Agent-8] ${briefingDateStr} 일일 브리핑 — ${memberName || "어드민"}`,
        emailBody:    `${emailBody}${suggestionsHtml}${alertsHtml}`,
        message:      ai.summaryMd?.slice(0, 200),
        link:         "/admin.html",
        category:     "briefing",
        severity:     ai.riskAlerts.some(a => a.severity === "high") ? "warning" : "info",
        briefingDate: briefingDateStr,
      },
    });

    return { ok: true };
  } catch (err: any) {
    console.error(`[agent-8] member ${memberId} 처리 실패:`, err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export default async (_req: Request, _ctx: Context) => {
  const start = Date.now();
  console.info("[agent-8] cron 시작", new Date().toISOString());

  try {
    const admins: any = await db
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(
        and(
          inArray(members.role, ["admin", "super_admin"]),
          isNull(members.withdrawnAt)
        )
      );

    if (!admins.length) {
      console.info("[agent-8] 활성 admin 없음 — 종료");
      return new Response(
        JSON.stringify({ ok: true, processed: 0, message: "활성 admin 없음" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const t = kstTimes();
    const briefingDate = t.kstToday;

    let success = 0;
    const errors: Array<{ memberId: number; error: string }> = [];

    for (const admin of admins) {
      const r = await processOneMember(admin.id, admin.name, briefingDate);
      if (r.ok) success++;
      else errors.push({ memberId: admin.id, error: r.error || "unknown" });
    }

    const durationMs = Date.now() - start;
    console.info(`[agent-8] 완료 ${success}/${admins.length}건 (${durationMs}ms)`);

    return new Response(
      JSON.stringify({
        ok: true,
        total: admins.length,
        success,
        failed: errors.length,
        durationMs,
        errors: errors.slice(0, 5),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[agent-8] fatal:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "unknown" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config = {
  schedule: "0 21 * * *", // UTC 21:00 = KST 06:00
};
