// netlify/functions/cron-anniversary-check.ts
// ★ Phase M-19-7: 매일 새벽 05:00 KST에 실행되는 기념일 축하 메일 cron
//
// Schedule: "0 20 * * *" (UTC 20:00 = KST 05:00)
//
// 로직:
// 1. getAllAnniversaryCandidates() → 오늘의 모든 기념일 대상 조회 (중복 제거 포함)
// 2. 각 대상자에게 맞는 이메일 템플릿 선택 + 발송
// 3. 성공/실패 모두 anniversary_emails_log에 기록
// 4. 최종 요약을 audit_logs에 기록 + super_admin에게 알림

import type { Context } from "@netlify/functions";
import {
  getAllAnniversaryCandidates,
  logAnniversaryEmailSent,
  type AnniversaryCandidate,
} from "../../lib/anniversary-checker";
import {
  sendEmail,
  tplAnniversarySignup1Month,
  tplAnniversarySignup1Year,
  tplFirstDonation1Year,
  tplDonationMilestone,
  tplRegularDonationAnniversary,
} from "../../lib/email";
import { logAudit } from "../../lib/audit";
import { notifyAllSuperAdmins } from "../../lib/notify";

/* ───────── 각 기념일 종류별 이메일 발송 ───────── */
async function sendAnniversaryEmail(c: AnniversaryCandidate): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    let tpl: { subject: string; html: string };

    switch (c.type) {
      case "signup_1month":
        tpl = tplAnniversarySignup1Month({ memberName: c.memberName });
        break;

      case "signup_1year":
        tpl = tplAnniversarySignup1Year({ memberName: c.memberName });
        break;

      case "first_donation_1year":
        tpl = tplFirstDonation1Year({ memberName: c.memberName });
        break;

      case "donation_milestone":
        if (!c.milestoneAmount || !c.totalDonation) {
          return { success: false, error: "마일스톤 정보 누락" };
        }
        tpl = tplDonationMilestone({
          memberName: c.memberName,
          milestoneAmount: c.milestoneAmount,
          totalDonation: c.totalDonation,
        });
        break;

      case "regular_donation_6months":
        tpl = tplRegularDonationAnniversary({
          memberName: c.memberName,
          months: 6,
        });
        break;

      case "regular_donation_1year":
        tpl = tplRegularDonationAnniversary({
          memberName: c.memberName,
          months: 12,
        });
        break;

      default:
        return { success: false, error: `알 수 없는 기념일 유형: ${c.type}` };
    }

    const result = await sendEmail({
      to: c.memberEmail,
      subject: tpl.subject,
      html: tpl.html,
    });

    if (!result.ok) {
      return { success: false, error: result.error || "sendEmail 실패" };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/* ───────── 메인 핸들러 ───────── */
export default async (req: Request, _ctx: Context) => {
  const startTime = Date.now();
  const today = new Date();

  try {
    console.log("[cron-anniversary-check] 시작:", today.toISOString());

    /* 1. 오늘의 기념일 대상 조회 */
    const candidates = await getAllAnniversaryCandidates();
    console.log(`[cron-anniversary-check] 대상자 수: ${candidates.length}`);

    /* 2. 각 대상자에게 이메일 발송 */
    let successCount = 0;
    let failCount = 0;
    const failedList: Array<{
      memberId: number;
      memberName: string;
      type: string;
      error: string;
    }> = [];

    /* 동시 발송 부하 분산 — 순차 처리 + 100ms 간격 */
    for (const c of candidates) {
      const result = await sendAnniversaryEmail(c);

      /* 발송 결과 로그 기록 */
      await logAnniversaryEmailSent(
        c.memberId,
        c.type,
        c.anniversaryDate,
        c.milestoneAmount,
        c.memberEmail,
        result.success ? "sent" : "failed",
        result.error,
        {
          memberName: c.memberName,
          totalDonation: c.totalDonation,
          regularMonths: c.regularMonths,
        }
      );

      if (result.success) {
        successCount++;
      } else {
        failCount++;
        failedList.push({
          memberId: c.memberId,
          memberName: c.memberName,
          type: c.type,
          error: result.error || "unknown",
        });
      }

      /* Rate limit 방어 */
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    /* 3. 타입별 통계 집계 */
    const typeStats: Record<string, number> = {};
    for (const c of candidates) {
      typeStats[c.type] = (typeStats[c.type] || 0) + 1;
    }

    const summary = {
      ok: true,
      timestamp: today.toISOString(),
      durationMs: Date.now() - startTime,
      totalCandidates: candidates.length,
      sentCount: successCount,
      failedCount: failCount,
      typeBreakdown: typeStats,
      failedSample: failedList.slice(0, 10),
    };

    console.log("[cron-anniversary-check] 완료:", summary);

    /* 4. 감사 로그 기록 */
    await logAudit({
      userType: "system",
      userName: "cron-anniversary-check",
      action: "cron_anniversary_complete",
      target: today.toISOString().slice(0, 10),
      detail: summary,
    }).catch(() => {});

    /* 5. super_admin 알림 (발송 건수 있을 때만) */
    if (successCount > 0) {
      try {
        await notifyAllSuperAdmins({
          category: "member",
          severity: "info",
          title: `🎉 오늘 기념일 축하 메일 ${successCount}건 발송 완료`,
          message: `총 ${candidates.length}명 대상 (성공: ${successCount} / 실패: ${failCount})`,
          link: "/admin.html#anniversary",
        });
      } catch (e) {
        console.warn("[cron-anniversary-check] super_admin 알림 실패:", e);
      }
    }

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[cron-anniversary-check] 전체 실패:", err);

    try {
      await logAudit({
        userType: "system",
        userName: "cron-anniversary-check",
        action: "cron_anniversary_error",
        target: today.toISOString().slice(0, 10),
        detail: { error: err?.message || String(err) },
        success: false,
      });
    } catch (_) {}

    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || "cron 실행 중 오류",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

/* 매일 새벽 05:00 KST = UTC 20:00 (전날) */
export const config = {
  schedule: "0 20 * * *",
};