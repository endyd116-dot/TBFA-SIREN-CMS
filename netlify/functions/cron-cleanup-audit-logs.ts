// netlify/functions/cron-cleanup-audit-logs.ts
/**
 * Scheduled Function: 감사 로그 자동 정리 cron
 *
 * - 매일 새벽 4:00 KST = UTC 19:00 (전날) 실행
 * - 1년 이상 된 audit_logs 행 자동 삭제
 * - 단, 보안상 중요한 액션(login_failed/login_locked/admin_login_failed/withdraw_*)은
 *   2년까지 보관 (분쟁 / 사후 추적 대비)
 * - 실행 결과는 audit_logs 자체에 cron_cleanup_audit_logs 액션으로 기록
 *
 * 보안:
 * - Scheduled Function만 호출 (외부 호출 차단)
 * - DELETE 카운트 로깅 + 실패 시 시스템 알림
 *
 * ★ Phase M-16: 핵심 4종 중 자동 정리 cron
 */
import { sql, lt, and, inArray, not } from "drizzle-orm";
import { db } from "../../db";
import { auditLogs } from "../../db/schema";
import { logAudit } from "../../lib/audit";

/* ───────── 보관 기간 정책 ───────── */
const RETENTION_DAYS_DEFAULT = 365;       // 일반 로그: 1년
const RETENTION_DAYS_SECURITY = 730;      // 보안 중요 로그: 2년

/* 2년 보관 대상 액션 (보안 사고/분쟁 대비) */
const SECURITY_ACTIONS = [
  "login_failed",
  "login_locked",
  "login_blocked",
  "admin_login_failed",
  "withdraw_success",
  "withdraw_blocked",
  "withdraw_failed",
  "password_reset_failed",
  "support_download_denied",
  "webhook_signature_invalid",
];

export default async (_req: Request) => {
  const startTime = Date.now();

  try {
    /* 1. 일반 로그 (1년 이상) 삭제
       - 단, SECURITY_ACTIONS는 제외 */
    const generalCutoff = new Date();
    generalCutoff.setDate(generalCutoff.getDate() - RETENTION_DAYS_DEFAULT);

    const generalResult: any = await db
      .delete(auditLogs)
      .where(
        and(
          lt(auditLogs.createdAt, generalCutoff),
          not(inArray(auditLogs.action, SECURITY_ACTIONS)),
        ),
      );

    const generalDeleted =
      Number(generalResult?.rowCount ?? generalResult?.count ?? 0) || 0;

    /* 2. 보안 로그 (2년 이상) 삭제 */
    const securityCutoff = new Date();
    securityCutoff.setDate(securityCutoff.getDate() - RETENTION_DAYS_SECURITY);

    const securityResult: any = await db
      .delete(auditLogs)
      .where(
        and(
          lt(auditLogs.createdAt, securityCutoff),
          inArray(auditLogs.action, SECURITY_ACTIONS),
        ),
      );

    const securityDeleted =
      Number(securityResult?.rowCount ?? securityResult?.count ?? 0) || 0;

    /* 3. 남은 로그 카운트 (참고) */
    const remaining: any = await db.execute(sql`
      SELECT COUNT(*)::int AS c FROM audit_logs
    `);
    const remainingCount = Number(
      remaining?.rows?.[0]?.c ?? remaining?.[0]?.c ?? 0,
    );

    const durationMs = Date.now() - startTime;
    const summary = {
      ok: true,
      generalDeleted,
      securityDeleted,
      totalDeleted: generalDeleted + securityDeleted,
      remainingCount,
      durationMs,
      generalCutoff: generalCutoff.toISOString(),
      securityCutoff: securityCutoff.toISOString(),
      timestamp: new Date().toISOString(),
    };

    console.log("[cron-cleanup-audit-logs] 완료:", summary);

    /* 4. 실행 결과를 audit_logs 자체에 기록 */
    await logAudit({
      userType: "system",
      userName: "cron-cleanup-audit-logs",
      action: "cron_cleanup_audit_logs",
      target: new Date().toISOString().slice(0, 10),
      detail: {
        generalDeleted,
        securityDeleted,
        totalDeleted: summary.totalDeleted,
        remainingCount,
        durationMs,
      },
    }).catch(() => {});

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[cron-cleanup-audit-logs] 실패:", err);

    /* 실패도 audit_logs에 기록 시도 (실패해도 무시) */
    await logAudit({
      userType: "system",
      userName: "cron-cleanup-audit-logs",
      action: "cron_cleanup_audit_logs_failed",
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
  schedule: "0 19 * * *",
};