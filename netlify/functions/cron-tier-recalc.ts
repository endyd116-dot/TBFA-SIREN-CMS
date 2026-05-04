// netlify/functions/cron-tier-recalc.ts
// ★ Phase M-19-4: 회원 등급 정기 재산정
// - 매주 일요일 새벽 4시 KST (UTC 토 19:00)
// - 모든 활성 회원 일괄 재산정
// - 등급 상승 시 알림 + 메일 자동 발송
// - super_admin에게 요약 알림

import { bulkRecalcTiers } from "../../lib/member-tier";
import { logAudit } from "../../lib/audit";
import { notifyAllSuperAdmins } from "../../lib/notify";

export default async (req: Request) => {
  const startTime = Date.now();
  const today = new Date();

  try {
    console.log("[cron-tier-recalc] 시작:", today.toISOString());

    /* 일괄 재산정 (알림/메일 자동 발송) */
    const result = await bulkRecalcTiers({
      sendNotifications: true,
      batchSize: 50,
    });

    const summary = {
      ok: true,
      timestamp: today.toISOString(),
      durationMs: Date.now() - startTime,
      totalMembers: result.total,
      changedCount: result.changed,
      upgradedCount: result.upgraded,
      downgradedCount: result.downgraded,
      errorCount: result.errors,
      upgradedSample: result.upgradedList.slice(0, 10).map((r) => ({
        memberId: r.memberId,
        memberName: r.memberName,
        prevTier: r.prevTier,
        newTier: r.newTier,
        score: r.newScore,
      })),
    };

    console.log("[cron-tier-recalc] 완료:", summary);

    /* 감사 로그 */
    await logAudit({
      userType: "system",
      userName: "cron-tier-recalc",
      action: "cron_tier_recalc_complete",
      target: today.toISOString().slice(0, 10),
      detail: summary,
    }).catch(() => {});

    /* 등급 상승자 있으면 super_admin에게 요약 알림 */
    if (result.upgraded > 0) {
      try {
        await notifyAllSuperAdmins({
          category: "member",
          severity: "info",
          title: `🎉 회원 등급 재산정 완료 (${result.upgraded}명 승급)`,
          message: `이번 주 ${result.upgraded}명의 회원이 새로운 등급으로 승급되었습니다. (총 ${result.total}명 검토)`,
          link: "/admin.html#members",
        });
      } catch (e) {
        console.warn("[cron-tier-recalc] super_admin 알림 실패:", e);
      }
    }

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[cron-tier-recalc] 전체 실패:", err);
    return new Response(JSON.stringify({
      ok: false,
      error: err?.message || "cron 실행 중 오류",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

/* 매주 일요일 새벽 4시 KST = UTC 토 19:00 */
export const config = {
  schedule: "0 19 * * 6",
};