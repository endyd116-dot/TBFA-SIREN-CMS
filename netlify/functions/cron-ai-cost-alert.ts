/**
 * cron-ai-cost-alert.ts — AI 비용 알림 + 이상 패턴 감지
 *
 * 매일 KST 09:00 (UTC 00:00) 실행:
 *   1) 이번 달 누적 비용 조회
 *   2) 임계($80) 도달했지만 오늘 아직 알림 안 보냈으면 이메일 발송
 *   3) 어제 단일일 비용이 평소 평균 대비 3배 이상이면 이상 패턴 알림
 *
 * 알림은 멱등 — ai_cost_summary의 updated_at + 임계 행 자체로 중복 발송 방지
 * 환경변수:
 *   ADMIN_NOTIFY_EMAIL  알림 받을 어드민 메일
 *   AI_MONTHLY_BUDGET_USD / AI_WARN_THRESHOLD_USD (lib/ai-cost-monitor에서 사용)
 */

import { todayKST } from "../../lib/kst";
import type { Config } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { sendEmail } from "../../lib/email";
import { getCostStats, checkMonthlyBudget } from "../../lib/ai-cost-monitor";

export default async (_req: Request) => {
  const notifyEmail = process.env.ADMIN_NOTIFY_EMAIL || "";
  if (!notifyEmail) {
    console.warn("[cron-ai-cost-alert] ADMIN_NOTIFY_EMAIL 미설정 — 알림 스킵");
    return new Response("no email configured", { status: 200 });
  }

  try {
    const [stats, budget] = await Promise.all([getCostStats(), checkMonthlyBudget()]);
    const sentToday = await wasAlertSentToday();

    const messages: string[] = [];

    /* 1) 월 한도 초과 (차단 상태) */
    if (!budget.ok && !sentToday.budgetExceeded) {
      messages.push(`<strong>월 AI 비용 한도 초과</strong>: $${stats.month.cost.toFixed(4)} / $${stats.limit.toFixed(2)} (한도 도달). 모든 AI 호출이 차단됐습니다.`);
      await markAlertSent("budget_exceeded");
    }
    /* 2) 경고 임계 도달 */
    else if (budget.warn && !sentToday.warnReached) {
      const pct = ((stats.month.cost / stats.limit) * 100).toFixed(1);
      messages.push(`<strong>월 AI 비용 경고</strong>: $${stats.month.cost.toFixed(4)} / $${stats.limit.toFixed(2)} (${pct}%) — 한도 임박. 일부 기능 사용을 줄이거나 한도(AI_MONTHLY_BUDGET_USD) 상향을 검토하세요.`);
      await markAlertSent("warn_reached");
    }

    /* 3) 이상 패턴 감지 — 어제 비용이 그 전 7일 평균의 3배 이상 */
    const surge = await detectCostSurge();
    if (surge && !sentToday.surgeDetected) {
      messages.push(`<strong>비용 급증 감지</strong>: 어제 비용 $${surge.yesterdayCost.toFixed(4)} (직전 7일 평균 $${surge.avgCost.toFixed(4)}의 <strong>${surge.ratio.toFixed(1)}배</strong>). 비정상 트리거 또는 무한 루프 가능성. /admin-ai-cost.html에서 기능별 사용량 확인을 권장합니다.`);
      await markAlertSent("surge_detected");
    }

    if (messages.length === 0) {
      return new Response("nothing to alert", { status: 200 });
    }

    /* 이메일 발송 */
    const html = `
      <div style="font-family:'Noto Sans KR',sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h2 style="color:#1e293b;font-size:18px">SIREN AI 비용 알림</h2>
        <ul style="line-height:1.7;color:#334155">
          ${messages.map(m => `<li>${m}</li>`).join("")}
        </ul>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">
        <p style="font-size:12px;color:#64748b">
          오늘 누적: $${stats.today.cost.toFixed(4)} (${stats.today.calls}회)<br>
          이번달 누적: $${stats.month.cost.toFixed(4)} (${stats.month.calls}회) / 한도 $${stats.limit.toFixed(2)}<br>
          어드민 화면: <a href="${process.env.SITE_URL || ""}/admin-ai-cost.html">/admin-ai-cost.html</a>
        </p>
      </div>`;

    await sendEmail({
      to: notifyEmail,
      subject: `[SIREN] AI 비용 알림 — ${todayKST()}`,
      html,
    });

    return new Response(JSON.stringify({ ok: true, sent: messages.length }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[cron-ai-cost-alert] 실패", err?.message);
    return new Response("error: " + (err?.message || ""), { status: 500 });
  }
};

/* =========================================================
   알림 중복 방지 — ai_cost_summary에 'alert_*' 가상 행을 사용
   period_type='alert', period_key=날짜+종류
   ========================================================= */
async function wasAlertSentToday(): Promise<{ budgetExceeded: boolean; warnReached: boolean; surgeDetected: boolean }> {
  const today = todayKST();
  try {
    const r: any = await db.execute(sql`
      SELECT period_key FROM ai_cost_summary
       WHERE period_type = 'alert'
         AND period_key LIKE ${today + "%"}
    `);
    const rows = r?.rows ?? r ?? [];
    const keys = rows.map((row: any) => String(row.period_key));
    return {
      budgetExceeded: keys.includes(`${today}:budget_exceeded`),
      warnReached:    keys.includes(`${today}:warn_reached`),
      surgeDetected:  keys.includes(`${today}:surge_detected`),
    };
  } catch {
    return { budgetExceeded: false, warnReached: false, surgeDetected: false };
  }
}

async function markAlertSent(kind: "budget_exceeded" | "warn_reached" | "surge_detected") {
  const today = todayKST();
  try {
    await db.execute(sql`
      INSERT INTO ai_cost_summary
        (period_type, period_key, feature_key, total_input_tokens, total_output_tokens, total_cost_usd, call_count, updated_at)
      VALUES ('alert', ${today + ":" + kind}, NULL, 0, 0, 0, 1, NOW())
      ON CONFLICT DO NOTHING
    `);
  } catch (e) {
    console.warn("[cron-ai-cost-alert] markAlertSent 실패", (e as any)?.message);
  }
}

/* =========================================================
   이상 패턴 — 어제 비용 vs 직전 7일 평균
   ========================================================= */
async function detectCostSurge(): Promise<{ yesterdayCost: number; avgCost: number; ratio: number } | null> {
  try {
    const r: any = await db.execute(sql`
      SELECT period_key, total_cost_usd::float AS cost
        FROM ai_cost_summary
       WHERE period_type = 'daily'
         AND feature_key IS NULL
         AND period_key >= TO_CHAR(NOW() - INTERVAL '8 days', 'YYYY-MM-DD')
       ORDER BY period_key DESC
    `);
    const rows = r?.rows ?? r ?? [];
    if (rows.length < 2) return null;

    const yesterdayKey = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const yesterdayRow = rows.find((row: any) => String(row.period_key) === yesterdayKey);
    if (!yesterdayRow) return null;
    const yesterdayCost = Number(yesterdayRow.cost) || 0;

    /* 어제 제외한 직전 7일 평균 */
    const others = rows.filter((row: any) => String(row.period_key) !== yesterdayKey);
    if (others.length === 0) return null;
    const avgCost = others.reduce((s: number, row: any) => s + (Number(row.cost) || 0), 0) / others.length;

    /* 평균이 0이면 의미 없음 (첫날) */
    if (avgCost < 0.0001) return null;

    const ratio = yesterdayCost / avgCost;
    if (ratio >= 3.0 && yesterdayCost >= 0.01) {
      return { yesterdayCost, avgCost, ratio };
    }
    return null;
  } catch {
    return null;
  }
}

/* Netlify Scheduled Function: 매일 KST 09:00 = UTC 00:00 */
export const config: Config = {
  schedule: "0 0 * * *",
};
