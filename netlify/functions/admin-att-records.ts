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
  if ((auth as any).ctx.member.role !== "super_admin") {
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

    // 오늘 집계 — status·work_mode 양쪽 (R34-P2: round2 M2·M3 정합)
    let statusCnt: Record<string, number> = {};
    let workModeCnt: Record<string, number> = {};
    try {
      const sRes = await db.execute(sql`
        SELECT status, COUNT(*)::int AS cnt
        FROM att_records
        WHERE date = ${date}::date
        GROUP BY status
      `);
      for (const row of sRes.rows as any[]) statusCnt[row.status] = row.cnt;
    } catch (err) {
      console.warn("[admin-att-records] status 집계 실패:", err);
    }
    try {
      const wRes = await db.execute(sql`
        SELECT work_mode, COUNT(*)::int AS cnt
        FROM att_records
        WHERE date = ${date}::date
          AND work_mode IS NOT NULL
        GROUP BY work_mode
      `);
      for (const row of wRes.rows as any[]) workModeCnt[row.work_mode] = row.cnt;
    } catch (err) {
      console.warn("[admin-att-records] work_mode 집계 실패:", err);
    }

    // 오늘 해당 날짜의 휴가 승인 건
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

    const checkinCount =
      (statusCnt["NORMAL"] ?? 0) +
      (statusCnt["LATE"] ?? 0) +
      (statusCnt["EARLY_LEAVE"] ?? 0);

    return jsonOk({
      date,
      records,
      summary: {
        // R34-P2 (round2 M3): lowerCamelCase 키로 통일, JS 직접 사용
        checkinCount,
        lateCount:    statusCnt["LATE"] ?? 0,
        earlyLeaveCount: statusCnt["EARLY_LEAVE"] ?? 0,
        absentCount:  statusCnt["ABSENT"] ?? 0,
        leaveCount:   (statusCnt["LEAVE"] ?? 0) + leaveCount,
        holidayCount: statusCnt["HOLIDAY"] ?? 0,
        // R34-P2 (round2 M2): work_mode별 집계 추가
        officeCount:       workModeCnt["OFFICE"] ?? 0,
        remoteCount:       workModeCnt["REMOTE"] ?? 0,
        fieldCount:        workModeCnt["FIELD"] ?? 0,
        businessTripCount: workModeCnt["BUSINESS_TRIP"] ?? 0,
        // 호환 보존 — 옛 키도 함께 노출 (점진 deprecation)
        NORMAL:      statusCnt["NORMAL"] ?? 0,
        LATE:        statusCnt["LATE"] ?? 0,
        EARLY_LEAVE: statusCnt["EARLY_LEAVE"] ?? 0,
        ABSENT:      statusCnt["ABSENT"] ?? 0,
        LEAVE:       statusCnt["LEAVE"] ?? 0,
        HOLIDAY:     statusCnt["HOLIDAY"] ?? 0,
        REMOTE:      statusCnt["REMOTE"] ?? 0,
        approvedLeave: leaveCount,
      },
    });
  } catch (err) {
    return jsonError("select_records", err);
  }
}
