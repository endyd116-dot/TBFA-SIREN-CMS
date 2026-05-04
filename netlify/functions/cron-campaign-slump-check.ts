// netlify/functions/cron-campaign-slump-check.ts
// ★ Phase M-19-2: 캠페인 진행 부진 자동 감지 + super_admin 알림
//
// 매주 월요일 오전 10시 KST (UTC 일요일 01:00) 실행
// - 활성 fundraising 캠페인 전체 검사
// - 진행률이 예상치 -15% 이하로 떨어진 캠페인 감지
// - 같은 캠페인에 7일 내 1회만 알림 (중복 방지)

import { eq, and, sql, isNotNull, or, isNull, lt } from "drizzle-orm";
import { db } from "../../db";
import { campaigns } from "../../db/schema";
import { logAudit } from "../../lib/audit";
import { notifyAllSuperAdmins } from "../../lib/notify";

export default async (req: Request) => {
  const startTime = Date.now();
  const today = new Date();

  try {
    console.log("[cron-campaign-slump-check] 시작:", today.toISOString());

    /* 활성 fundraising 캠페인 조회 (목표/시작/종료 모두 있는 것만) */
    const targets = await db
      .select()
      .from(campaigns)
      .where(and(
        eq(campaigns.status, "active"),
        eq(campaigns.type, "fundraising"),
        eq(campaigns.isPublished, true),
        isNotNull(campaigns.goalAmount),
        isNotNull(campaigns.startDate),
        isNotNull(campaigns.endDate),
      ));

    console.log(`[cron-campaign-slump-check] 검사 대상: ${targets.length}건`);

    const slumpCampaigns: any[] = [];
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    for (const c of targets) {
      const goal = c.goalAmount || 0;
      const raised = c.raisedAmount || 0;

      if (goal <= 0) continue;

      const startMs = new Date(c.startDate as any).getTime();
      const endMs = new Date(c.endDate as any).getTime();
      const totalMs = endMs - startMs;
      if (totalMs <= 0) continue;

      const elapsedMs = Date.now() - startMs;
      if (elapsedMs <= 0) continue; // 아직 시작 전

      const expectedPercent = Math.max(0, Math.min(100, (elapsedMs / totalMs) * 100));
      const actualPercent = (raised / goal) * 100;
      const gap = actualPercent - expectedPercent;

      /* 부진 조건: 예상치보다 15%p 이상 낮음 */
      if (gap < -15) {
        /* 7일 내 알림 보낸 적 있으면 스킵 */
        if (c.lastSlumpAlertAt && new Date(c.lastSlumpAlertAt) > sevenDaysAgo) {
          continue;
        }

        slumpCampaigns.push({
          id: c.id,
          slug: c.slug,
          title: c.title,
          goal,
          raised,
          expectedPercent: Math.round(expectedPercent * 10) / 10,
          actualPercent: Math.round(actualPercent * 10) / 10,
          gap: Math.round(gap * 10) / 10,
        });
      }
    }

    /* super_admin에게 알림 + lastSlumpAlertAt 갱신 */
    let notifyCount = 0;
    for (const c of slumpCampaigns) {
      try {
        await notifyAllSuperAdmins({
          category: "donation",
          severity: "warning",
          title: `📉 캠페인 진행 부진: ${c.title}`,
          message: `목표 ₩${c.goal.toLocaleString()} 중 ₩${c.raised.toLocaleString()} (${c.actualPercent}% / 예상 ${c.expectedPercent}%, ${c.gap}%p 부족)`,
          link: `/admin.html#ai`,
          refTable: "campaigns",
          refId: c.id,
        });

        await db.update(campaigns).set({
          lastSlumpAlertAt: new Date(),
        } as any).where(eq(campaigns.id, c.id));

        notifyCount++;
      } catch (e) {
        console.warn(`[cron-campaign-slump-check] 알림 실패 id=${c.id}:`, e);
      }
    }

    const summary = {
      ok: true,
      timestamp: today.toISOString(),
      durationMs: Date.now() - startTime,
      checked: targets.length,
      slumpDetected: slumpCampaigns.length,
      notified: notifyCount,
      slumpList: slumpCampaigns.slice(0, 10),
    };

    console.log("[cron-campaign-slump-check] 완료:", summary);

    await logAudit({
      userType: "system",
      userName: "cron-campaign-slump-check",
      action: "cron_campaign_slump_complete",
      target: today.toISOString().slice(0, 10),
      detail: summary,
    }).catch(() => {});

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[cron-campaign-slump-check] 전체 실패:", err);
    return new Response(JSON.stringify({
      ok: false,
      error: err?.message || "cron 실행 중 오류",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

/* 매주 월요일 오전 10시 KST = UTC 일요일 01:00 */
export const config = {
  schedule: "0 1 * * 1",
};