/**
 * SIREN — 감사 로그 헬퍼
 * 모든 중요 활동을 audit_logs 테이블에 기록합니다.
 */
import { db, auditLogs, NewAuditLog } from "../db";
import { getClientIp, getUserAgent } from "./response";

export type AuditUserType = "admin" | "user" | "system" | "anonymous";
export type RiskLevel = "critical" | "high" | "medium" | "low";

/** riskLevel 기준 상수 */
export const RISK_LEVEL_MAP: Record<string, RiskLevel> = {
  // critical
  member_blacklist: "critical",
  donation_refund: "critical",
  admin_permission_change: "critical",
  // high
  member_delete: "high",
  bulk_operation: "high",
  // medium
  member_update: "medium",
  donation_update: "medium",
  report_status_change: "medium",
};

export function resolveRiskLevel(action: string, loginFailCount?: number): RiskLevel {
  if (action === "login_fail" && loginFailCount != null && loginFailCount >= 5) return "high";
  return RISK_LEVEL_MAP[action] ?? "low";
}

export interface AuditLogParams {
  req?: Request;
  userId?: number | null;
  userType?: AuditUserType;
  userName?: string | null;
  action: string;            // ex) "login", "donate", "update_member"
  target?: string | null;    // ex) "M-08423", "S-2026-0413"
  detail?: any;              // 객체나 문자열
  success?: boolean;
  errorMessage?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;   // Phase 17: 세션 ID (optional)
  riskLevel?: RiskLevel | null; // Phase 17: 위험 등급 (optional, 미제공 시 자동 계산)
}

/**
 * 감사 로그 기록 (실패해도 메인 로직에 영향 없도록 try/catch)
 */
export async function logAudit(params: AuditLogParams): Promise<void> {
  try {
    const detailStr =
      params.detail === undefined || params.detail === null
        ? null
        : typeof params.detail === "string"
        ? params.detail
        : JSON.stringify(params.detail).slice(0, 5000);

    await db.insert(auditLogs).values({
      userId: params.userId ?? null,
      userType: params.userType ?? "system",
      userName: params.userName ?? null,
      action: params.action,
      target: params.target ?? null,
      detail: detailStr,
      ipAddress: params.ipAddress ?? (params.req ? getClientIp(params.req) : null),
      userAgent: params.userAgent ?? (params.req ? getUserAgent(params.req) : null),
      success: params.success ?? true,
      errorMessage: params.errorMessage ?? null,
      // Phase 17 필드 (DB 마이그레이션 후 활성화)
      // sessionId: params.sessionId ?? null,
      // riskLevel: params.riskLevel ?? resolveRiskLevel(params.action),
    } as any);
  } catch (err) {
    // 감사 로그 실패는 콘솔에만 기록 (메인 흐름 방해 X)
    console.error("[AuditLog Failed]", err, params);
  }
}

/**
 * 사용자 활동 로그 단축 헬퍼
 */
export async function logUserAction(
  req: Request,
  userId: number | null,
  userName: string | null,
  action: string,
  options: { target?: string; detail?: any; success?: boolean; error?: string } = {}
): Promise<void> {
  await logAudit({
    req,
    userId,
    userType: userId ? "user" : "anonymous",
    userName,
    action,
    target: options.target,
    detail: options.detail,
    success: options.success ?? true,
    errorMessage: options.error,
  });
}

/**
 * 관리자 활동 로그 단축 헬퍼
 */
export async function logAdminAction(
  req: Request,
  adminId: number,
  adminName: string,
  action: string,
  options: { target?: string; detail?: any; success?: boolean; error?: string } = {}
): Promise<void> {
  await logAudit({
    req,
    userId: adminId,
    userType: "admin",
    userName: adminName,
    action,
    target: options.target,
    detail: options.detail,
    success: options.success ?? true,
    errorMessage: options.error,
  });
}