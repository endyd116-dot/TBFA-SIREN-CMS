import { db } from "../../db";
import { auditLogs } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { desc, eq, and, sql, ilike, gte } from "drizzle-orm";

export const config = { path: "/api/admin-audit-list" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false,
    error: "감사 로그 조회 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
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
  const action = url.searchParams.get("action") || "";
  const riskLevel = url.searchParams.get("riskLevel") || "";
  const userId = url.searchParams.get("userId") || "";
  const periodParam = url.searchParams.get("period") || "30d";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50")));
  const offset = (page - 1) * limit;

  const validPeriods: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
  const days = validPeriods[periodParam] ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let rows: any[] = [];
  let total = 0;

  try {
    const conditions: any[] = [];
    conditions.push(gte(auditLogs.createdAt, since));
    if (action) conditions.push(ilike(auditLogs.action, `%${action}%`));
    if (userId) conditions.push(eq(auditLogs.userId, parseInt(userId)));

    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

    const [countResult, rawRows] = await Promise.all([
      db.select({ cnt: sql<number>`count(*)` })
        .from(auditLogs)
        .where(whereClause),
      db.select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        userName: auditLogs.userName,
        userType: auditLogs.userType,
        action: auditLogs.action,
        target: auditLogs.target,
        detail: auditLogs.detail,
        ipAddress: auditLogs.ipAddress,
        success: auditLogs.success,
        createdAt: auditLogs.createdAt,
      })
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    total = Number(countResult[0]?.cnt ?? 0);
    rows = rawRows;
  } catch (err) {
    return jsonError("select_logs", err);
  }

  // riskLevel 필터는 자동 계산 기준으로 JS에서 처리 (DB 컬럼 마이그레이션 전)
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

  let logs = rows.map((r) => ({
    id: r.id,
    userName: r.userName ?? "",
    userType: r.userType ?? "system",
    action: r.action,
    target: r.target ?? null,
    detail: r.detail ?? null,
    ipAddress: r.ipAddress ?? null,
    riskLevel: getRiskLevel(r.action),
    success: r.success ?? true,
    createdAt: r.createdAt,
  }));

  // riskLevel 필터 적용
  if (riskLevel) {
    logs = logs.filter((l) => l.riskLevel === riskLevel);
  }

  return new Response(JSON.stringify({
    ok: true,
    total,
    page,
    logs,
  }), { headers: { "Content-Type": "application/json" } });
}
