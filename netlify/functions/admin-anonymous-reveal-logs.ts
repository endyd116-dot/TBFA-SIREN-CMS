// admin-anonymous-reveal-logs.ts — 익명 식별 감사 로그 조회
// GET /api/admin-anonymous-reveal-logs?reportType=&reportId=&page=1
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { db } from "../../db";
import { anonymousRevealLogs, members } from "../../db/schema";
import { and, eq, desc, inArray, sql } from "drizzle-orm";

export const config = { path: "/api/admin-anonymous-reveal-logs" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "감사 로그 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "허용되지 않는 메서드" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  // R45 CLUSTER-2: 신원 식별 감사로그 조회도 같은 권한 게이트(operator 차단)
  if (!(await canAccess(auth.ctx.member.role ?? "", "anonymous_reveal"))) {
    return new Response(JSON.stringify({ ok: false, error: "신원 식별 권한이 없습니다", step: "auth_role" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const reportType = url.searchParams.get("reportType");
  const reportId = url.searchParams.get("reportId") ? Number(url.searchParams.get("reportId")) : undefined;
  const levelParam = url.searchParams.get("level") ? Number(url.searchParams.get("level")) : undefined;
  const dateFrom = url.searchParams.get("dateFrom") || "";
  const dateTo = url.searchParams.get("dateTo") || "";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = 30;
  const offset = (page - 1) * limit;

  let rows: any[] = [];
  try {
    const conds: any[] = [];
    if (reportType) conds.push(eq(anonymousRevealLogs.reportType, reportType));
    if (reportId) conds.push(eq(anonymousRevealLogs.reportId, reportId));
    if (levelParam) conds.push(eq(anonymousRevealLogs.revealLevel, levelParam));
    if (dateFrom) conds.push(sql`${anonymousRevealLogs.createdAt} >= ${dateFrom}::timestamptz`);
    if (dateTo) conds.push(sql`${anonymousRevealLogs.createdAt} < (${dateTo}::date + interval '1 day')`);
    const cond = conds.length > 0 ? (conds.length === 1 ? conds[0] : and(...conds)) : undefined;

    rows = await db.select({
      id: anonymousRevealLogs.id,
      reportType: anonymousRevealLogs.reportType,
      reportId: anonymousRevealLogs.reportId,
      revealLevel: anonymousRevealLogs.revealLevel,
      revealedBy: anonymousRevealLogs.revealedBy,
      reason: anonymousRevealLogs.reason,
      ipAddress: anonymousRevealLogs.ipAddress,
      createdAt: anonymousRevealLogs.createdAt,
    })
      .from(anonymousRevealLogs)
      .where(cond)
      .orderBy(desc(anonymousRevealLogs.createdAt))
      .limit(limit)
      .offset(offset);
  } catch (err) {
    return jsonError("select_logs", err);
  }

  // 열람 어드민 이름 보강
  const adminIds = [...new Set(rows.map((r) => r.revealedBy as number))];
  const nameMap = new Map<number, string>();
  if (adminIds.length > 0) {
    try {
      const ms = await db.select({ id: members.id, name: members.name })
        .from(members)
        .where(inArray(members.id, adminIds));
      ms.forEach((m) => nameMap.set(m.id, m.name));
    } catch (err) {
      console.warn("[admin-anonymous-reveal-logs] 어드민 이름 조회 실패", err);
    }
  }

  // KPI 통계 집계
  let stats = { totalCount: 0, todayCount: 0, level2Count: 0, monthCount: 0 };
  try {
    const statsRes: any = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today_count,
        COUNT(*) FILTER (WHERE reveal_level = 2)::int AS level2_count,
        COUNT(*) FILTER (WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW()))::int AS month_count
      FROM anonymous_reveal_logs
    `);
    const s = (statsRes.rows || statsRes)[0] || {};
    stats = {
      totalCount: s.total_count || 0,
      todayCount: s.today_count || 0,
      level2Count: s.level2_count || 0,
      monthCount: s.month_count || 0,
    };
  } catch (err) {
    console.warn("[admin-anonymous-reveal-logs] stats 집계 실패", err);
  }

  return new Response(JSON.stringify({
    ok: true,
    page,
    total: stats.totalCount,
    stats,
    items: rows.map((r) => ({ ...r, revealedByName: nameMap.get(r.revealedBy) || "" })),
  }), { headers: { "Content-Type": "application/json" } });
};
