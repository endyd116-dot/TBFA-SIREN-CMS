/**
 * cron-agent-9.ts — Phase 4 주간 대표 보고서 자동 생성 + 이메일 발송
 *
 * 스케줄: 매주 월 KST 06:00 = UTC 일 21:00 → "0 21 * * 0"
 *
 * 동작:
 *   1. 전주 월 00:00 KST ~ 일 23:59 KST 기간 계산
 *   2. collectReportStats → stats 수집
 *   3. Gemini Flash → ai_summary(핵심 5줄) + ai_alerts(위험경보)
 *   4. report_snapshots INSERT
 *   5. ADMIN_NOTIFY_EMAIL + super_admin 이메일 목록으로 Resend 발송
 *   6. AI 실패 시 수치 기반 폴백 자동 생성
 */

import type { Config } from "@netlify/functions";
import { db, reportSnapshots, members } from "../../db";
import { eq, inArray } from "drizzle-orm";
import { collectReportStats, ReportStats } from "../../lib/report-collector";
import { callGeminiJSON } from "../../lib/ai-gemini";
import { sendEmail } from "../../lib/email";

interface AiReportOutput {
  summary: string[];
  alerts: Array<{ type: string; message: string; severity: "low" | "medium" | "high" }>;
}

/* KST 기준 전주 월~일 */
function lastWeekKst(): { start: Date; end: Date; label: string } {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 3600 * 1000);
  const dow = kstNow.getUTCDay(); // 0=일,1=월,...
  const daysToLastMon = dow === 0 ? 6 : dow - 1;
  const lastMon = new Date(kstNow);
  lastMon.setUTCDate(lastMon.getUTCDate() - daysToLastMon - 7);
  lastMon.setUTCHours(0, 0, 0, 0);
  const lastSun = new Date(lastMon);
  lastSun.setUTCDate(lastSun.getUTCDate() + 6);
  lastSun.setUTCHours(23, 59, 59, 999);
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { start: lastMon, end: lastSun, label: `${fmt(lastMon)} ~ ${fmt(lastSun)}` };
}

function buildEmailHtml(stats: ReportStats, aiSummary: string, aiAlerts: any[], label: string): string {
  const alerts = (aiAlerts ?? []).map((a: any) => {
    const color = a.severity === "high" ? "#e53e3e" : a.severity === "medium" ? "#dd6b20" : "#718096";
    return `<li style="color:${color};margin-bottom:6px;">[${a.type}] ${a.message}</li>`;
  }).join("");

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#2d3748;max-width:640px;margin:auto;padding:24px;">
<h2 style="color:#2b6cb0;">[SIREN 주간 보고] ${label}</h2>
<hr/>
<h3>AI 핵심 요약</h3>
<div style="background:#ebf8ff;padding:16px;border-radius:8px;white-space:pre-wrap;">${aiSummary || "(AI 요약 없음)"}</div>
${alerts ? `<h3>위험경보</h3><ul>${alerts}</ul>` : ""}
<h3>주요 통계</h3>
<table style="border-collapse:collapse;width:100%;">
  <tr style="background:#edf2f7;"><td style="padding:8px;font-weight:bold;">회원</td><td style="padding:8px;">신규 ${stats.members.newThisPeriod}명 / 활성 전체 ${stats.members.totalActive}명</td></tr>
  <tr><td style="padding:8px;font-weight:bold;">후원</td><td style="padding:8px;">${stats.donations.count}건 / ${stats.donations.totalAmount.toLocaleString()}원 | 정기후원자 ${stats.donations.regularActive}명</td></tr>
  <tr style="background:#edf2f7;"><td style="padding:8px;font-weight:bold;">사건신고</td><td style="padding:8px;">신규 ${stats.siren.incident.newThisPeriod}건 (미처리 ${stats.siren.incident.totalOpen}건)</td></tr>
  <tr><td style="padding:8px;font-weight:bold;">괴롭힘신고</td><td style="padding:8px;">신규 ${stats.siren.harassment.newThisPeriod}건 (미처리 ${stats.siren.harassment.totalOpen}건)</td></tr>
  <tr style="background:#edf2f7;"><td style="padding:8px;font-weight:bold;">법률신고</td><td style="padding:8px;">신규 ${stats.siren.legal.newThisPeriod}건 (미처리 ${stats.siren.legal.totalOpen}건)</td></tr>
  <tr><td style="padding:8px;font-weight:bold;">전문가매칭</td><td style="padding:8px;">신규 ${stats.expertMatches.newThisPeriod}건 / 진행중 ${stats.expertMatches.active}건</td></tr>
  <tr style="background:#edf2f7;"><td style="padding:8px;font-weight:bold;">유족지원</td><td style="padding:8px;">신규 ${stats.support.newThisPeriod}건 (상담${stats.support.byCategory.counseling}/법률${stats.support.byCategory.legal}/장학${stats.support.byCategory.scholarship})</td></tr>
</table>
<p style="color:#a0aec0;font-size:12px;margin-top:24px;">이 메일은 SIREN 플랫폼 Agent-9가 자동 발송했습니다.</p>
</body></html>`;
}

export default async () => {
  console.log("[cron-agent-9] 주간 보고서 생성 시작");
  const period = lastWeekKst();

  /* 1. 통계 수집 */
  let stats: ReportStats;
  try {
    stats = await collectReportStats(period.start, period.end);
  } catch (err) {
    console.error("[cron-agent-9] 통계 수집 실패", err);
    return;
  }

  /* 2. AI 요약 */
  let aiSummary = "";
  let aiAlerts: any[] = [];
  try {
    const prompt = `다음 SIREN NPO 플랫폼 주간 통계를 분석하여 대표 보고용 요약을 작성해주세요.

통계(${period.label}):
${JSON.stringify(stats, null, 2)}

JSON 형식으로만 응답:
{
  "summary": ["핵심 1줄","핵심 2줄","핵심 3줄","핵심 4줄","핵심 5줄"],
  "alerts": [{"type":"유형","message":"내용","severity":"low|medium|high"}]
}`;
    const r = await callGeminiJSON<AiReportOutput>(prompt, { maxOutputTokens: 1500, featureKey: "weekly_report_generation" });
    if (r.ok && r.data) {
      aiSummary = Array.isArray(r.data.summary) ? r.data.summary.join("\n") : String(r.data.summary);
      aiAlerts  = r.data.alerts ?? [];
    }
  } catch (err) { console.warn("[cron-agent-9] AI 실패, 폴백", err); }

  if (!aiSummary) {
    aiSummary = [
      `이번 주 신규 회원 ${stats.members.newThisPeriod}명 가입`,
      `후원 완료 ${stats.donations.count}건, 총 ${stats.donations.totalAmount.toLocaleString()}원`,
      `SIREN 신고 신규 접수 사건${stats.siren.incident.newThisPeriod}/괴롭힘${stats.siren.harassment.newThisPeriod}/법률${stats.siren.legal.newThisPeriod}건`,
      `전문가 매칭 진행중 ${stats.expertMatches.active}건`,
      `유족지원 신규 신청 ${stats.support.newThisPeriod}건`,
    ].join("\n");
  }

  /* 3. DB INSERT */
  let reportId: number | null = null;
  try {
    const inserted = await db.insert(reportSnapshots).values({
      reportType: "weekly",
      periodStart: period.start,
      periodEnd:   period.end,
      stats:       stats as any,
      aiSummary,
      aiAlerts:    aiAlerts as any,
      generatedBy: null,
    } as any).returning({ id: reportSnapshots.id });
    reportId = inserted[0]?.id ?? null;
  } catch (err) { console.error("[cron-agent-9] INSERT 실패", err); }

  /* 4. 이메일 발송 */
  const toList: Array<{ email: string; name: string }> = [];
  const notifyEmail = process.env.ADMIN_NOTIFY_EMAIL;
  if (notifyEmail) toList.push({ email: notifyEmail, name: "SIREN 관리자" });

  try {
    /* ★ P1-18 fix: super_admin은 members.role에 저장됨(member_subtype은 회원 4분류용).
       cron-agent-8·cron-att-ai-daily와 동일하게 role로 식별. */
    const superAdmins = await db.select({ id: members.id, name: members.name, email: members.email })
      .from(members)
      .where(eq(members.role, "super_admin"))
      .limit(10);
    for (const a of superAdmins) {
      if (a.email && !toList.find(t => t.email === a.email)) {
        toList.push({ email: a.email, name: a.name ?? "관리자" });
      }
    }
  } catch (err) { console.warn("[cron-agent-9] super_admin 조회 실패", err); }

  const emailHtml = buildEmailHtml(stats, aiSummary, aiAlerts, period.label);
  const subject = `[SIREN 주간 보고] ${period.label}`;
  const sentTo: Array<{ email: string; name: string }> = [];

  for (const to of toList) {
    try {
      const r = await sendEmail({ to: to.email, subject, html: emailHtml });
      if (r.ok) sentTo.push(to);
    } catch (err) { console.warn("[cron-agent-9] 이메일 발송 실패", to.email, err); }
  }

  /* 5. sentEmailAt + sentTo 갱신 */
  if (reportId && sentTo.length > 0) {
    try {
      const { eq } = await import("drizzle-orm");
      await db.update(reportSnapshots).set({
        sentEmailAt: new Date(),
        sentTo: sentTo as any,
      } as any).where(eq(reportSnapshots.id, reportId));
    } catch (err) { console.warn("[cron-agent-9] sentEmail 갱신 실패", err); }
  }

  console.log(`[cron-agent-9] 완료 — reportId=${reportId}, 발송=${sentTo.length}건`);
};

export const config: Config = {
  schedule: "0 21 * * 0",
};
