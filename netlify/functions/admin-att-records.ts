import { db } from "../../db/index";
import { attRecords, attLeaveRequests, attHolidays, members } from "../../db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-att-records" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "근태 현황 조회 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  if (auth.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const statusFilter = url.searchParams.get("status");

  try {
    // 날짜별 출퇴근 기록
    const whereConditions = statusFilter
      ? and(eq(attRecords.date, date), eq(attRecords.status, statusFilter))
      : eq(attRecords.date, date);

    const records = await db
      .select()
      .from(attRecords)
      .where(whereConditions)
      .orderBy(attRecords.memberUid);

    // 오늘 집계 (각 상태별 count)
    let summary: Record<string, number> = {};
    try {
      const countResult = await db.execute(sql`
        SELECT status, COUNT(*)::int AS cnt
        FROM att_records
        WHERE date = ${date}::date
        GROUP BY status
      `);
      for (const row of countResult.rows as any[]) {
        summary[row.status] = row.cnt;
      }
    } catch (err) {
      console.warn("[admin-att-records] summary 집계 실패:", err);
    }

    // 오늘 해당 날짜의 휴가 승인 건 (att_records에 없는 사람 기준 보완용)
    let leaveCount = 0;
    try {
      const leaveResult = await db.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM att_leave_requests
        WHERE status = 'APPROVED'
          AND start_date <= ${date}::date
          AND end_date >= ${date}::date
      `);
      leaveCount = Number((leaveResult.rows[0] as any)?.cnt ?? 0);
    } catch (err) {
      console.warn("[admin-att-records] 휴가 집계 실패:", err);
    }

    return jsonOk({
      date,
      records,
      summary: {
        NORMAL:        summary["NORMAL"] ?? 0,
        LATE:          summary["LATE"] ?? 0,
        EARLY_LEAVE:   summary["EARLY_LEAVE"] ?? 0,
        ABSENT:        summary["ABSENT"] ?? 0,
        LEAVE:         summary["LEAVE"] ?? 0,
        HOLIDAY:       summary["HOLIDAY"] ?? 0,
        REMOTE:        summary["REMOTE"] ?? 0,
        approvedLeave: leaveCount,
      },
    });
  } catch (err) {
    return jsonError("select_records", err);
  }
}
