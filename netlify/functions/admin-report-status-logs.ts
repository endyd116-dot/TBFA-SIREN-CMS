// admin-report-status-logs.ts — 신고 단계 변경 이력 조회
// GET /api/admin-report-status-logs?reportType=incident&reportId=1
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { reportStatusLogs, members } from "../../db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";

export const config = { path: "/api/admin-report-status-logs" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "단계 이력 조회 실패", step,
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
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const reportType = url.searchParams.get("reportType");
  const reportId = url.searchParams.get("reportId") ? Number(url.searchParams.get("reportId")) : undefined;

  if (!reportType || !reportId) {
    return new Response(JSON.stringify({ ok: false, error: "reportType, reportId 필수" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  let rows: any[] = [];
  try {
    rows = await db.select({
      id: reportStatusLogs.id,
      fromStatus: reportStatusLogs.fromStatus,
      toStatus: reportStatusLogs.toStatus,
      changedBy: reportStatusLogs.changedBy,
      note: reportStatusLogs.note,
      notifiedAt: reportStatusLogs.notifiedAt,
      createdAt: reportStatusLogs.createdAt,
    })
      .from(reportStatusLogs)
      .where(and(eq(reportStatusLogs.reportType, reportType), eq(reportStatusLogs.reportId, reportId)))
      .orderBy(desc(reportStatusLogs.createdAt))
      .limit(100);
  } catch (err) {
    return jsonError("select_logs", err);
  }

  // 처리자 이름 보강
  const adminIds = [...new Set(rows.map((r) => r.changedBy).filter(Boolean) as number[])];
  const nameMap = new Map<number, string>();
  if (adminIds.length > 0) {
    try {
      const ms = await db.select({ id: members.id, name: members.name })
        .from(members)
        .where(inArray(members.id, adminIds));
      ms.forEach((m) => nameMap.set(m.id, m.name));
    } catch (err) {
      console.warn("[admin-report-status-logs] 처리자 이름 조회 실패", err);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    items: rows.map((r) => ({ ...r, changedByName: r.changedBy ? (nameMap.get(r.changedBy) || "") : "" })),
  }), { headers: { "Content-Type": "application/json" } });
};
