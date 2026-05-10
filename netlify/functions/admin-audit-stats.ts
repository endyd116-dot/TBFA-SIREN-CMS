import { db } from "../../db";
import { auditLogs } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { gte, sql } from "drizzle-orm";

export const config = { path: "/api/admin-audit-stats" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false,
    error: "감사 통계 조회 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

const RISK_MAP: Record<string, string> = {
  member_blacklist: "critical",
  donation_refund: "critical",
  admin_permission_change: "critical",
  member_delete: "high",
  bulk_operation: "high",
  member_update: "medium",
  donation_update: "medium",
  report_status_change: "medium",
};

function getRiskLevel(action: string): string {
  return RISK_MAP[action] ?? "low";
}

export default async function handler(req: Request) {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), { status: 405 });
  }

  let auth: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;
  } catch (err) {
    return jsonError("auth", err);
  }

  const url = new URL(req.url);
  const periodParam = url.searchParams.get("period") || "30d";
  const validPeriods: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
  const days = validPeriods[periodParam] ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let allRows: any[] = [];
  try {
    allRows = await db.select({
      action: auditLogs.action,
      ipAddress: auditLogs.ipAddress,
      success: auditLogs.success,
    })
      .from(auditLogs)
      .where(gte(auditLogs.createdAt, since));
  } catch (err) {
    return jsonError("select_all", err);
  }

  // byAction 집계
  const actionMap = new Map<string, number>();
  const ipSet = new Set<string>();
  let failedLogins = 0;

  // 실제 로그인 실패 시 기록되는 액션명 (auth-login: login_failed, admin-login: admin_login_failed/admin_login_blocked)
  const FAILED_LOGIN_ACTIONS = new Set([
    "login_failed",
    "admin_login_failed",
    "admin_login_blocked",
    "login_locked",
    "login_blocked",
  ]);

  for (const row of allRows) {
    actionMap.set(row.action, (actionMap.get(row.action) ?? 0) + 1);
    if (row.ipAddress) ipSet.add(row.ipAddress);
    if (FAILED_LOGIN_ACTIONS.has(row.action) || (row.action === "login" && row.success === false)) {
      failedLogins++;
    }
  }

  const byAction = Array.from(actionMap.entries())
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count);

  // byRiskLevel 집계
  const riskMap = new Map<string, number>([
    ["critical", 0], ["high", 0], ["medium", 0], ["low", 0],
  ]);
  for (const row of allRows) {
    const level = getRiskLevel(row.action);
    riskMap.set(level, (riskMap.get(level) ?? 0) + 1);
  }
  const byRiskLevel = [
    { level: "critical", count: riskMap.get("critical") ?? 0 },
    { level: "high", count: riskMap.get("high") ?? 0 },
    { level: "medium", count: riskMap.get("medium") ?? 0 },
    { level: "low", count: riskMap.get("low") ?? 0 },
  ];

  return new Response(JSON.stringify({
    ok: true,
    period: periodParam,
    byAction,
    byRiskLevel,
    failedLogins,
    uniqueIps: ipSet.size,
  }), { headers: { "Content-Type": "application/json" } });
}
