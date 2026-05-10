// admin-anonymous-reveal-logs.ts — 익명 식별 감사 로그 조회
// GET /api/admin-anonymous-reveal-logs?reportType=&reportId=&page=1
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { anonymousRevealLogs, members } from "../../db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";

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
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const reportType = url.searchParams.get("reportType");
  const reportId = url.searchParams.get("reportId") ? Number(url.searchParams.get("reportId")) : undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = 30;
  const offset = (page - 1) * limit;

  let rows: any[] = [];
  try {
    const cond = reportType && reportId
      ? and(eq(anonymousRevealLogs.reportType, reportType), eq(anonymousRevealLogs.reportId, reportId))
      : reportType
        ? eq(anonymousRevealLogs.reportType, reportType)
        : undefined;

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

  return new Response(JSON.stringify({
    ok: true,
    page,
    items: rows.map((r) => ({ ...r, revealedByName: nameMap.get(r.revealedBy) || "" })),
  }), { headers: { "Content-Type": "application/json" } });
};
