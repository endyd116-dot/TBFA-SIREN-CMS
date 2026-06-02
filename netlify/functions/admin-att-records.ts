import { db } from "../../db/index";
import { attRecords, attLeaveRequests, attHolidays, members } from "../../db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";

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
  if (guardFailed(auth)) return auth.res;
  // R45 §4-1: 근태 현황 조회는 운영자 허용(att_manage)
  if (!(await canAccess((auth as any).ctx.member.role ?? "", "att_manage"))) {
    return new Response(JSON.stringify({ ok: false, error: "근태 관리 권한이 없습니다" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const url = new URL(req.url);
  const dateFromQ = url.searchParams.get("dateFrom");
  const dateToQ   = url.searchParams.get("dateTo");
  const memberUid = url.searchParams.get("memberUid");

  /* ── R38 A-2: 기간(dateFrom~dateTo) + 직원(memberUid) 조회 분기 ──
     기존 단일 ?date= 응답은 변경 없이 유지.
     기간 조회 응답: { dateFrom, dateTo, memberUid, records, leaves } */
  if (dateFromQ && dateToQ) {
    try {
      // 기간 형식 검증 (YYYY-MM-DD)
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRe.test(dateFromQ) || !dateRe.test(dateToQ)) {
        return new Response(JSON.stringify({
          ok: false, error: "dateFrom·dateTo 형식이 잘못되었습니다 (YYYY-MM-DD 필수)",
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      if (dateFromQ > dateToQ) {
        return new Response(JSON.stringify({
          ok: false, error: "dateFrom이 dateTo보다 늦을 수 없습니다",
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      const baseWhere = memberUid
        ? and(
            gte(attRecords.date, dateFromQ),
            lte(attRecords.date, dateToQ),
            eq(attRecords.memberUid, memberUid),
          )
        : and(
            gte(attRecords.date, dateFromQ),
            lte(attRecords.date, dateToQ),
          );

      const rangeRecords = await db
        .select()
        .from(attRecords)
        .where(baseWhere)
        .orderBy(attRecords.date, attRecords.memberUid);

      // 기간 내 승인 휴가 (memberUid 필터 적용 — 일자별 휴가 표시용)
      let leaveRows: any[] = [];
      try {
        const leaveRes = memberUid
          ? await db.execute(sql`
              SELECT id, member_uid, leave_type_id, start_date, end_date,
                     is_half_day, half_day_period, reason
              FROM att_leave_requests
              WHERE status = 'APPROVED'
                AND start_date <= ${dateToQ}::date
                AND end_date   >= ${dateFromQ}::date
                AND member_uid = ${memberUid}
              ORDER BY start_date
            `)
          : await db.execute(sql`
              SELECT id, member_uid, leave_type_id, start_date, end_date,
                     is_half_day, half_day_period, reason
              FROM att_leave_requests
              WHERE status = 'APPROVED'
                AND start_date <= ${dateToQ}::date
                AND end_date   >= ${dateFromQ}::date
              ORDER BY start_date
            `);
        leaveRows = ((leaveRes as any).rows ?? leaveRes) as any[];
      } catch (err) {
        console.warn("[admin-att-records range] leave query 실패:", err);
      }

      return jsonOk({
        dateFrom: dateFromQ,
        dateTo:   dateToQ,
        memberUid: memberUid || null,
        records:  rangeRecords,
        leaves:   leaveRows,
      });
    } catch (err) {
      return jsonError("select_range", err);
    }
  }

  /* ── 기존 단일 ?date= 흐름 (호환 유지) ── */
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

    /* ★ 2026-06-02 fix(출퇴근 기록 빈칸): member_uid(=members.id 문자열)로 이름 매핑 +
       프런트가 읽는 키(memberName/mode/checkinAt/checkoutAt)로 별칭 부여.
       기존엔 원본 행만 반환해 직원·근무형태·출퇴근시각이 전부 '—'로 표시됐다. */
    let recNameMap: Record<string, string> = {};
    try {
      const ids = Array.from(new Set(records.map((r: any) => Number(r.memberUid)).filter((n) => Number.isFinite(n) && n > 0)));
      if (ids.length > 0) {
        const nr: any = await db.execute(sql`
          SELECT id, name FROM members WHERE id = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})
        `);
        for (const row of (nr?.rows ?? nr ?? [])) recNameMap[String(row.id)] = String(row.name ?? "");
      }
    } catch (err) {
      console.warn("[admin-att-records] 이름 매핑 실패:", err);
    }
    const recordsEnriched = records.map((r: any) => ({
      ...r,
      memberName: recNameMap[String(r.memberUid)] || r.memberUid,
      mode: r.workMode,
      checkinAt: r.checkInTime,
      checkoutAt: r.checkOutTime,
    }));

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
      for (const row of (((sRes as any).rows ?? sRes) as any[])) statusCnt[row.status] = row.cnt;
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
      for (const row of (((wRes as any).rows ?? wRes) as any[])) workModeCnt[row.work_mode] = row.cnt;
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
      leaveCount = Number(((leaveResult as any).rows?.[0] as any)?.cnt ?? 0);
    } catch (err) {
      console.warn("[admin-att-records] 휴가 집계 실패:", err);
    }

    const checkinCount =
      (statusCnt["NORMAL"] ?? 0) +
      (statusCnt["LATE"] ?? 0) +
      (statusCnt["EARLY_LEAVE"] ?? 0);

    return jsonOk({
      date,
      records: recordsEnriched,
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
