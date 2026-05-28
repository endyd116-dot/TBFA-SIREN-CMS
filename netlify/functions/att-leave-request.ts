import { db } from "../../db/index";
import { attLeaveRequests, attLeaveBalances, attHolidays, attRecords, members } from "../../db/schema";
import { eq, and, sql, inArray, gte, lte, isNotNull, notInArray } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { notifyAllOperators } from "../../lib/notify";

export const config = { path: "/api/att-leave-request" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "휴가 신청 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;

  const method = req.method;

  const memberUid: string = String(auth.ctx.member.id);

  // GET — 본인 신청 내역 (R34-P2 round3 P-G1: camelCase 정합)
  if (method === "GET") {
    try {
      const result: any = await db.execute(sql`
        SELECT
          r.id, r.member_uid, r.leave_type_id, r.start_date, r.end_date,
          r.days, r.reason, r.status, r.reviewed_by, r.review_note,
          r.created_at, r.updated_at,
          lt.name AS leave_type_name, lt.unit, lt.is_paid
        FROM att_leave_requests r
        JOIN att_leave_types lt ON lt.id = r.leave_type_id
        WHERE r.member_uid = ${memberUid}
        ORDER BY r.created_at DESC
        LIMIT 100
      `);
      const rows = (result.rows as any[]).map(r => ({
        id:           Number(r.id),
        memberUid:    r.member_uid,
        leaveTypeId:  Number(r.leave_type_id),
        leaveTypeName: r.leave_type_name,
        unit:         r.unit,
        isPaid:       r.is_paid,
        startDate:    r.start_date,
        endDate:      r.end_date,
        days:         r.days,
        reason:       r.reason,
        status:       r.status,
        reviewedBy:   r.reviewed_by,
        reviewNote:   r.review_note,
        createdAt:    r.created_at,
        updatedAt:    r.updated_at,
      }));
      return jsonOk(rows);
    } catch (err) {
      return jsonError("select_requests", err);
    }
  }

  // POST — 휴가 신청 (R29-ATT-GAP2: 서버 검증 강화)
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { leaveTypeId, startDate, endDate, reason, isHalfDay, halfDayPeriod } = body;
    if (!leaveTypeId || !startDate || !endDate) {
      return jsonError("validate", new Error("leaveTypeId, startDate, endDate 필수"), 400);
    }

    // 1. 서버에서 일수 직접 계산 (클라이언트 days 값 무시)
    //    반차(isHalfDay=true)면 0.5일, 아니면 (end-start)+1
    const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
    const endMs   = new Date(`${endDate}T00:00:00Z`).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return jsonError("validate_date", new Error("날짜 형식이 올바르지 않습니다"), 400);
    }
    let days: number;
    if (isHalfDay === true) {
      // 반차는 시작=종료 강제 + 0.5일
      if (startDate !== endDate) {
        return jsonError("validate_halfday", new Error("반차는 단일 날짜만 신청할 수 있습니다"), 400);
      }
      if (!["AM", "PM"].includes(String(halfDayPeriod))) {
        return jsonError("validate_halfday_period", new Error("반차 시간대(halfDayPeriod)는 AM 또는 PM"), 400);
      }
      days = 0.5;
    } else {
      // ★ Q3-008 fix: 달력일 전체가 아니라 영업일(주말·att_holidays 제외)만 차감.
      //   승인 시 att_records LEAVE 스탬프는 영업일에만 찍히므로(admin-att-leave-review),
      //   기존 달력일 계산은 금~월 등 주말 낀 휴가에서 연차를 과다 차감했다.
      let holidaySet = new Set<string>();
      try {
        const hRows = await db
          .select({ date: attHolidays.date })
          .from(attHolidays)
          .where(and(gte(attHolidays.date, startDate), lte(attHolidays.date, endDate)));
        holidaySet = new Set(hRows.map((h: any) => String(h.date)));
      } catch (err) {
        console.warn("[att-leave-request] 공휴일 조회 실패 — 주말만 제외:", err);
      }
      let biz = 0;
      let cur = new Date(`${startDate}T00:00:00Z`);
      const endD = new Date(`${endDate}T00:00:00Z`);
      while (cur.getTime() <= endD.getTime()) {
        const dow = cur.getUTCDay();              // 0=일 6=토
        const ds = cur.toISOString().slice(0, 10);
        if (dow !== 0 && dow !== 6 && !holidaySet.has(ds)) biz++;
        cur = new Date(cur.getTime() + 86_400_000);
      }
      days = biz;
    }
    if (days <= 0) {
      return jsonError("validate_range", new Error("신청 기간에 영업일이 없습니다 (주말·공휴일 제외)"), 400);
    }

    // 2. 잔여일 검증 (잔액 row 없으면 0일로 간주 → 미배정 휴가종류는 차단)
    const year = new Date(startDate).getFullYear();
    let remaining = 0;
    try {
      const balRows = await db
        .select()
        .from(attLeaveBalances)
        .where(and(
          eq(attLeaveBalances.memberUid, memberUid),
          eq(attLeaveBalances.leaveTypeId, leaveTypeId),
          eq(attLeaveBalances.year, year),
        ))
        .limit(1);
      const balance = balRows[0];
      if (balance) {
        remaining = Number(balance.totalDays) - Number(balance.usedDays);
      }
    } catch (err) {
      console.warn("[att-leave-request] 잔여 검증 실패:", err);
    }
    /* ★ P1-13 fix: used_days는 승인 시점에만 증가 → 승인 대기(PENDING) 다건이 각각 통과해
       잔여를 초과할 수 있음. 같은 연도·종류의 PENDING 합산을 잔여에서 차감해 막는다. */
    let pendingDays = 0;
    try {
      const pendRows: any = await db
        .select({ s: sql<string>`COALESCE(SUM(${attLeaveRequests.days}), 0)` })
        .from(attLeaveRequests)
        .where(and(
          eq(attLeaveRequests.memberUid, memberUid),
          eq(attLeaveRequests.leaveTypeId, leaveTypeId),
          eq(attLeaveRequests.status, "PENDING"),
          sql`EXTRACT(YEAR FROM ${attLeaveRequests.startDate}) = ${year}`,
        ));
      pendingDays = Number(pendRows[0]?.s || 0);
    } catch (err) {
      console.warn("[att-leave-request] PENDING 합산 실패:", err);
    }
    const effectiveRemaining = remaining - pendingDays;
    if (effectiveRemaining < days) {
      return new Response(JSON.stringify({
        ok: false,
        error: `휴가 잔여일이 부족합니다 (잔여: ${effectiveRemaining}일${pendingDays > 0 ? ` · 승인대기 ${pendingDays}일 차감 후` : ""}, 신청: ${days}일)`,
        step: "balance_check",
      }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // 3. 날짜 충돌 검사 — 동일 직원의 PENDING/APPROVED 중 기간 겹치는 건
    try {
      const overlap = await db
        .select({ id: attLeaveRequests.id, startDate: attLeaveRequests.startDate, endDate: attLeaveRequests.endDate })
        .from(attLeaveRequests)
        .where(and(
          eq(attLeaveRequests.memberUid, memberUid),
          inArray(attLeaveRequests.status, ["PENDING", "APPROVED"]),
          lte(attLeaveRequests.startDate, endDate),
          gte(attLeaveRequests.endDate, startDate),
        ))
        .limit(1);
      if (overlap.length > 0) {
        return new Response(JSON.stringify({
          ok: false,
          error: "해당 기간에 이미 휴가 신청이 존재합니다",
          step: "overlap_check",
          conflict: overlap[0],
        }), { status: 409, headers: { "Content-Type": "application/json" } });
      }
    } catch (err) {
      console.warn("[att-leave-request] 충돌 검사 실패:", err);
    }

    /* 3-2. 출근 기록 충돌 검사 (2026-05-29 운영 시작 전 P1-1 fix)
       — 종일 휴가 신청 시 신청 기간 안에 이미 출근 기록(checkInTime 있는 NORMAL/LATE/EARLY_LEAVE 등)이 있으면 차단.
       — 반차(isHalfDay)는 출근 후 반나절 휴가가 정상이라 패스.
       — LEAVE/HOLIDAY/ABSENT 상태는 출근 안 한 날이라 충돌 아님. */
    if (isHalfDay !== true) {
      try {
        const attOverlap = await db
          .select({ id: attRecords.id, date: attRecords.date, status: attRecords.status })
          .from(attRecords)
          .where(and(
            eq(attRecords.memberUid, memberUid),
            gte(attRecords.date, startDate),
            lte(attRecords.date, endDate),
            isNotNull(attRecords.checkInTime),
            notInArray(attRecords.status, ["LEAVE", "HOLIDAY", "ABSENT"]),
          ))
          .limit(1);
        if (attOverlap.length > 0) {
          return new Response(JSON.stringify({
            ok: false,
            error: `해당 기간(${attOverlap[0].date})에 이미 출근 기록이 있습니다. 반차로 신청하거나 관리자에게 출근 기록 정정을 문의하세요`,
            step: "attendance_overlap",
            conflict: attOverlap[0],
          }), { status: 409, headers: { "Content-Type": "application/json" } });
        }
      } catch (err) {
        console.warn("[att-leave-request] 출근 충돌 검사 실패:", err);
      }
    }

    // 4. INSERT — 반차 컬럼은 마이그(migrate-att-r29-halfday) 적용된 환경에서만 저장
    try {
      // 반차 컬럼 존재 여부 동적 확인
      let halfDayExists = false;
      try {
        const c: any = await db.execute(sql`
          SELECT COUNT(*)::int AS cnt FROM information_schema.columns
          WHERE table_name='att_leave_requests'
            AND column_name IN ('is_half_day','half_day_period')
        `);
        halfDayExists = Number(((c.rows ?? [])[0] ?? {}).cnt ?? 0) >= 2;
      } catch {}

      let result: any;
      if (halfDayExists) {
        result = await db.execute(sql`
          INSERT INTO att_leave_requests
            (member_uid, leave_type_id, start_date, end_date, days, reason, status,
             is_half_day, half_day_period)
          VALUES
            (${memberUid}, ${leaveTypeId}, ${startDate}::date, ${endDate}::date,
             ${String(days)}, ${reason ?? null}, 'PENDING',
             ${isHalfDay === true}, ${isHalfDay === true ? halfDayPeriod : null})
          RETURNING id
        `);
      } else {
        // 마이그 미적용 — 반차 플래그는 무시(0.5일은 days 컬럼에 기록됨)
        if (isHalfDay === true) {
          console.warn("[att-leave-request] half-day columns missing — flag dropped");
        }
        result = await db.execute(sql`
          INSERT INTO att_leave_requests
            (member_uid, leave_type_id, start_date, end_date, days, reason, status)
          VALUES
            (${memberUid}, ${leaveTypeId}, ${startDate}::date, ${endDate}::date,
             ${String(days)}, ${reason ?? null}, 'PENDING')
          RETURNING id
        `);
      }

      const row = (result.rows ?? [])[0] ?? {};
      const leaveId = Number(row.id);

      /* 어드민·운영자에게 결재 대기 알림 (2026-05-29 P1-2 fix·운영 시작 전) */
      try {
        const [requester] = await db
          .select({ name: members.name })
          .from(members)
          .where(eq(members.id, Number(memberUid)))
          .limit(1);
        const requesterName = requester?.name || "직원";
        const periodText = startDate === endDate ? startDate : `${startDate}~${endDate}`;
        await notifyAllOperators({
          category: "system",
          severity: "info",
          title: `🌴 휴가 결재 대기 — ${requesterName}`,
          message: `${periodText} (${days}일${isHalfDay === true ? `·반차 ${halfDayPeriod}` : ""})${reason ? ` · ${String(reason).slice(0, 80)}` : ""}`,
          link: "/admin.html#att-leave",
          refTable: "att_leave_requests",
          refId: leaveId,
        });
      } catch (notifyErr) {
        console.warn("[att-leave-request] 어드민 결재 대기 알림 실패:", notifyErr);
      }

      return jsonOk({ leaveId, days, remaining: remaining - days }, 201);
    } catch (err) {
      return jsonError("insert_request", err);
    }
  }

  // DELETE — 본인 PENDING 신청 셀프 철회 (Q3-009 잔여)
  //   PENDING은 아직 잔여 차감 전이라 복원 불필요 — 행 삭제만. 승인 후 취소는 관리자(admin-att-leave-review CANCELLED).
  if (method === "DELETE") {
    const url = new URL(req.url);
    const reqId = Number(url.searchParams.get("id"));
    if (!reqId) return jsonError("validate", new Error("id 필수"), 400);
    try {
      const [r] = await db.select().from(attLeaveRequests).where(eq(attLeaveRequests.id, reqId)).limit(1);
      if (!r) return jsonError("not_found", new Error("신청을 찾을 수 없습니다"), 404);
      if (String(r.memberUid) !== memberUid) return jsonError("forbidden", new Error("본인 신청만 철회할 수 있습니다"), 403);
      if (r.status !== "PENDING") return jsonError("invalid_status", new Error("승인 대기 중인 신청만 철회할 수 있습니다"), 409);
      await db.delete(attLeaveRequests).where(eq(attLeaveRequests.id, reqId));
      return jsonOk({ withdrawn: true, id: reqId });
    } catch (err) {
      return jsonError("withdraw", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
