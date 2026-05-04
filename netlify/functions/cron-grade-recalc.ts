// netlify/functions/cron-grade-recalc.ts
// ★ Phase M-19-1: 매일 새벽 03:30 KST 회원 등급 일괄 재계산
//
// 스케줄: netlify.toml에서 schedule = "30 18 * * *" (UTC 18:30 = KST 03:30)
//
// 동작:
// - 모든 active 회원 등급 재산정
// - 등급 상승 시 알림 + 메일 자동 발송 (recalculateGrade 내부에서)
// - 결과 요약을 audit_logs에 system 액션으로 기록

import { db, auditLogs } from "../../db";
import { recalculateAllGrades } from "../../lib/grade-calculator";

export default async (req: Request) => {
  console.log("[cron-grade-recalc] 시작", new Date().toISOString());

  const startedAt = Date.now();
  const result = await recalculateAllGrades();
  const elapsedMs = Date.now() - startedAt;

  console.log("[cron-grade-recalc] 완료:", result, `${elapsedMs}ms`);

  /* 감사 로그 기록 */
  try {
    await db.insert(auditLogs).values({
      userType: "system",
      userName: "cron-grade-recalc",
      action: "grade_recalc_all",
      target: `total=${result.total}`,
      detail: JSON.stringify({
        ...result,
        elapsedMs,
        ranAt: new Date().toISOString(),
      }),
      success: result.errors === 0,
    } as any);
  } catch (e) {
    console.error("[cron-grade-recalc] audit log 실패:", e);
  }

  return new Response(
    JSON.stringify({ ok: true, ...result, elapsedMs }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

export const config = {
  schedule: "30 18 * * *",
};