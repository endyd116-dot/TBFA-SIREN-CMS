// netlify/functions/cron-churn-predictor.ts
// ★ Phase M-19-1: 후원자 이탈 예측 cron
// - 매일 새벽 04:00 KST (UTC 19:00 전날) 실행
// - 활성 정기 후원자 또는 최근 6개월 내 후원한 회원 전체 평가
// - 룰 기반 점수 + AI 종합 분석 (Q61: 원안 (b) — 모든 회원 AI 분석)
// - 평가 결과는 members 테이블에 캐시 (어드민 UI에서 즉시 조회)
//
// 외부 호출 차단 — Scheduled Function만 호출 가능

import { evaluateAllActiveDonors } from "../../lib/churn-predictor";
import { logAudit } from "../../lib/audit";
import { notifyAllSuperAdmins } from "../../lib/notify";

export default async (req: Request) => {
  const startTime = Date.now();
  const today = new Date();

  try {
    console.log("[cron-churn-predictor] 시작:", today.toISOString());

    /* 환경변수 체크 — AI 비활성 옵션 (긴급 비용 차단용) */
    const aiDisabled = process.env.CHURN_AI_DISABLED === "true";
    const useAI = !aiDisabled;

    if (aiDisabled) {
      console.log("[cron-churn-predictor] ⚠️ AI 분석 비활성화됨 (CHURN_AI_DISABLED=true)");
    }

    /* 평가 실행 */
    const stats = await evaluateAllActiveDonors({
      useAI,
      limit: 1000, // 안전 한도
    });

    const durationMs = Date.now() - startTime;
    const summary = {
      ok: true,
      timestamp: today.toISOString(),
      durationMs,
      durationSec: Math.round(durationMs / 1000),
      useAI,
      ...stats,
    };

    console.log("[cron-churn-predictor] 완료:", summary);

    /* 감사 로그 */
    await logAudit({
      userType: "system",
      userName: "cron-churn-predictor",
      action: "cron_churn_predictor_complete",
      target: today.toISOString().slice(0, 10),
      detail: summary,
    }).catch(() => {});

    /* CRITICAL 등급 회원이 5명 이상 발견되면 super_admin에게 알림 */
    if (stats.byLevel.critical >= 5) {
      try {
        await notifyAllSuperAdmins({
          category: "member",
          severity: "warning",
          title: `⚠️ 이탈 위험 회원 ${stats.byLevel.critical}명 감지`,
          message: `오늘 평가 결과 CRITICAL ${stats.byLevel.critical}명 / WARNING ${stats.byLevel.warning}명이 감지되었습니다. 재참여 유도 메일 발송을 검토해 주세요.`,
          link: "/admin.html#ai",
          refTable: "members",
        });
      } catch (e) {
        console.warn("[cron-churn-predictor] super_admin 알림 실패:", e);
      }
    }

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[cron-churn-predictor] 전체 실패:", err);

    await logAudit({
      userType: "system",
      userName: "cron-churn-predictor",
      action: "cron_churn_predictor_failed",
      target: today.toISOString().slice(0, 10),
      detail: { error: err?.message?.slice(0, 500) },
      success: false,
    }).catch(() => {});

    return new Response(JSON.stringify({
      ok: false,
      error: err?.message || "cron 실행 중 오류",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

/* ───────── Scheduled Function 설정 ─────────
   매일 새벽 4시 KST = UTC 19:00 (전날) */
export const config = {
  schedule: "0 19 * * *",  // UTC 19:00 = KST 04:00
};