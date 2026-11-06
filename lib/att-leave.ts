// lib/att-leave.ts — 휴가 신청·결재의 공용 처리 (2026-11-06)
//
// 근태 화면과 내부결재가 같은 규칙을 쓰도록 att-leave-request, admin-att-leave-review의 처리를 옮겼다.
// 규칙은 바꾸지 않았다. 잔여일·겹침·출근 기록 검사, 영업일 계산, 승인 시 차감과 LEAVE 기록이 그대로다.
import { and, eq, gte, inArray, isNotNull, lte, notInArray, sql } from "drizzle-orm";
import { db } from "../db/index";
import { attHolidays, attLeaveBalances, attLeaveRequests, attRecords, members } from "../db/schema";
import { notifyAllOperators } from "./notify";
import { sendWorkspaceNotification } from "./workspace-logger";

const HALF_PERIODS = ["AM", "PM"];
const QUARTER_PERIODS = ["LATE_IN", "EARLY_OUT"];
const PERIOD_LABEL: Record<string, string> = {
  AM: "오전 반차",
  PM: "오후 반차",
  LATE_IN: "반반차(늦게 출근)",
  EARLY_OUT: "반반차(일찍 퇴근)",
};

function execRows(result: any): any[] {
  return (result?.rows ?? result ?? []) as any[];
}

/** 신청 거절. plain이면 message를 그대로 error로 내보낸다(기존 응답 유지) */
export class LeaveRequestError extends Error {
  constructor(public step: string, message: string, public status = 400, public plain = false, public conflict: any = null) {
    super(message);
    this.name = "LeaveRequestError";
  }
}

export interface LeaveInput {
  leaveTypeId: any;
  startDate: any;
  endDate: any;
  reason?: any;
  halfDayPeriod?: any;
  isHalfDay?: any;
}

/** 휴가 신청 검사와 저장. notify가 false면 근태 결재 대기 알림을 보내지 않는다(내부결재가 알림을 맡는다). */
export async function createLeaveRequest(memberUid: string, input: LeaveInput, notify = true) {
  const { leaveTypeId, startDate, endDate, reason, halfDayPeriod } = input;
  if (!leaveTypeId || !startDate || !endDate) throw new LeaveRequestError("validate", "leaveTypeId, startDate, endDate 필수");

  /* 부분 휴가 판별 — 반차(0.5일) / 반반차(0.25일).
     반반차도 is_half_day=true로 저장한다: 그날 출근은 하되 지각·조퇴로 보지 않는 기존 반차 처리가 그대로 맞기 때문. */
  const period = String(halfDayPeriod || "");
  const isQuarterDay = QUARTER_PERIODS.includes(period);
  const isPartial = isQuarterDay || HALF_PERIODS.includes(period) || input.isHalfDay === true;

  const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
  const endMs = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new LeaveRequestError("validate_date", "날짜 형식이 올바르지 않습니다");

  let days: number;
  if (isPartial) {
    if (startDate !== endDate) throw new LeaveRequestError("validate_halfday", "반차·반반차는 단일 날짜만 신청할 수 있습니다");
    if (!HALF_PERIODS.includes(period) && !isQuarterDay) {
      throw new LeaveRequestError("validate_halfday_period", "시간대는 오전 반차(AM)·오후 반차(PM)·늦게 출근(LATE_IN)·일찍 퇴근(EARLY_OUT) 중 하나여야 합니다");
    }
    days = isQuarterDay ? 0.25 : 0.5;
  } else {
    /* 달력일이 아니라 영업일(주말·공휴일 제외)만 차감한다 */
    let holidaySet = new Set<string>();
    try {
      const hRows = await db
        .select({ date: attHolidays.date })
        .from(attHolidays)
        .where(and(gte(attHolidays.date, startDate), lte(attHolidays.date, endDate)));
      holidaySet = new Set(hRows.map((h: any) => String(h.date)));
    } catch (err) {
      console.warn("[att-leave] 공휴일 조회 실패 — 주말만 제외:", err);
    }
    let biz = 0;
    let cur = new Date(`${startDate}T00:00:00Z`);
    const endD = new Date(`${endDate}T00:00:00Z`);
    while (cur.getTime() <= endD.getTime()) {
      const dow = cur.getUTCDay();
      const ds = cur.toISOString().slice(0, 10);
      if (dow !== 0 && dow !== 6 && !holidaySet.has(ds)) biz++;
      cur = new Date(cur.getTime() + 86_400_000);
    }
    days = biz;
  }
  if (days <= 0) throw new LeaveRequestError("validate_range", "신청 기간에 영업일이 없습니다 (주말·공휴일 제외)");

  /* 잔여일 검증 (잔액 행이 없으면 0일로 간주해 미배정 휴가종류를 막는다) */
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
    if (balance) remaining = Number(balance.totalDays) - Number(balance.usedDays);
  } catch (err) {
    console.warn("[att-leave] 잔여 검증 실패:", err);
  }
  /* used_days는 승인 시점에만 늘어나므로 승인 대기 합계를 잔여에서 뺀다 */
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
    console.warn("[att-leave] PENDING 합산 실패:", err);
  }
  const effectiveRemaining = remaining - pendingDays;
  if (effectiveRemaining < days) {
    throw new LeaveRequestError(
      "balance_check",
      `휴가 잔여일이 부족합니다 (잔여: ${effectiveRemaining}일${pendingDays > 0 ? ` · 승인대기 ${pendingDays}일 차감 후` : ""}, 신청: ${days}일)`,
      400, true,
    );
  }

  /* 같은 직원의 대기·승인 건과 기간이 겹치면 막는다 */
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
    if (overlap.length > 0) throw new LeaveRequestError("overlap_check", "해당 기간에 이미 휴가 신청이 존재합니다", 409, true, overlap[0]);
  } catch (err) {
    if (err instanceof LeaveRequestError) throw err;
    console.warn("[att-leave] 충돌 검사 실패:", err);
  }

  /* 종일 휴가는 이미 출근한 날과 겹치면 막는다. 반차·반반차는 출근 후 일부 시간만 쉬는 것이 정상이다 */
  if (!isPartial) {
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
        throw new LeaveRequestError(
          "attendance_overlap",
          `해당 기간(${attOverlap[0].date})에 이미 출근 기록이 있습니다. 반차·반반차로 신청하거나 관리자에게 출근 기록 정정을 문의하세요`,
          409, true, attOverlap[0],
        );
      }
    } catch (err) {
      if (err instanceof LeaveRequestError) throw err;
      console.warn("[att-leave] 출근 충돌 검사 실패:", err);
    }
  }

  /* 부분휴가 컬럼은 마이그가 적용된 환경에서만 저장한다 */
  let halfDayExists = false;
  try {
    const c: any = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM information_schema.columns
      WHERE table_name='att_leave_requests' AND column_name IN ('is_half_day','half_day_period')
    `);
    halfDayExists = Number((execRows(c)[0] ?? {}).cnt ?? 0) >= 2;
  } catch { /* 없는 것으로 친다 */ }

  let result: any;
  if (halfDayExists) {
    result = await db.execute(sql`
      INSERT INTO att_leave_requests
        (member_uid, leave_type_id, start_date, end_date, days, reason, status, is_half_day, half_day_period)
      VALUES
        (${memberUid}, ${leaveTypeId}, ${startDate}::date, ${endDate}::date,
         ${String(days)}, ${reason ?? null}, 'PENDING', ${isPartial}, ${isPartial ? period : null})
      RETURNING id
    `);
  } else {
    if (isPartial) console.warn("[att-leave] half-day columns missing — flag dropped");
    result = await db.execute(sql`
      INSERT INTO att_leave_requests
        (member_uid, leave_type_id, start_date, end_date, days, reason, status)
      VALUES
        (${memberUid}, ${leaveTypeId}, ${startDate}::date, ${endDate}::date,
         ${String(days)}, ${reason ?? null}, 'PENDING')
      RETURNING id
    `);
  }
  const leaveId = Number((execRows(result)[0] ?? {}).id) || null;

  if (notify) {
    try {
      const [requester] = await db.select({ name: members.name }).from(members).where(eq(members.id, Number(memberUid))).limit(1);
      const requesterName = requester?.name || "직원";
      const periodText = startDate === endDate ? startDate : `${startDate}~${endDate}`;
      await notifyAllOperators({
        category: "system",
        severity: "info",
        title: `휴가 결재 대기 — ${requesterName}`,
        message: `${periodText} (${days}일${isPartial && PERIOD_LABEL[period] ? ` · ${PERIOD_LABEL[period]}` : ""})${reason ? ` · ${String(reason).slice(0, 80)}` : ""}`,
        link: "/cms-tbfa.html#att-ops",
        refTable: "att_leave_requests",
        refId: leaveId,
      });
    } catch (notifyErr) {
      console.warn("[att-leave] 어드민 결재 대기 알림 실패:", notifyErr);
    }
  }
  return { leaveId, days, remaining: remaining - days };
}

/** 대기 중 신청 철회. 잔여가 아직 차감되지 않았으므로 행만 지운다. */
export async function withdrawLeaveRequest(leaveId: number): Promise<void> {
  const [r] = await db.select().from(attLeaveRequests).where(eq(attLeaveRequests.id, leaveId)).limit(1);
  if (r && r.status === "PENDING") await db.delete(attLeaveRequests).where(eq(attLeaveRequests.id, leaveId));
}

export type LeaveAction = "APPROVED" | "REJECTED" | "CANCELLED";

/** 승인·반려·승인 취소 처리. 호출 전에 상태 전이와 셀프 결재를 확인한다. */
export async function applyLeaveDecision(request: any, action: LeaveAction, reviewerId: string, note: any) {
  const [updated] = await db
    .update(attLeaveRequests)
    .set({ status: action, reviewedBy: reviewerId, reviewNote: note ?? null, updatedAt: new Date() } as any)
    .where(eq(attLeaveRequests.id, request.id))
    .returning();

  if (action === "APPROVED") {
    const year = new Date(request.startDate).getFullYear();
    try {
      /* 해당 연도·종류 잔여 행이 없어도 차감이 조용히 누락되지 않도록 UPSERT로 처리한다 */
      await db.execute(sql`
        INSERT INTO att_leave_balances (member_uid, leave_type_id, year, total_days, used_days)
        VALUES (${request.memberUid}, ${request.leaveTypeId}, ${year}, 0, ${request.days})
        ON CONFLICT (member_uid, leave_type_id, year)
        DO UPDATE SET used_days = att_leave_balances.used_days + ${request.days}
      `);
    } catch (err) {
      console.warn("[att-leave] 잔여 휴가 차감 실패:", err);
    }

    /* 휴가 기간 영업일(주말·공휴일 제외)에 근태 LEAVE를 기록한다 */
    try {
      const startStr = String(request.startDate);
      const endStr = String(request.endDate);
      const hRows = await db
        .select({ date: attHolidays.date })
        .from(attHolidays)
        .where(and(gte(attHolidays.date, startStr), lte(attHolidays.date, endStr)));
      const holidaySet = new Set(hRows.map((h) => String(h.date)));

      const dates: string[] = [];
      let cur = new Date(`${startStr}T00:00:00Z`);
      const end = new Date(`${endStr}T00:00:00Z`);
      while (cur.getTime() <= end.getTime()) {
        const dow = cur.getUTCDay();
        const ds = cur.toISOString().slice(0, 10);
        if (dow !== 0 && dow !== 6 && !holidaySet.has(ds)) dates.push(ds);
        cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
      }

      for (const d of dates) {
        /* 반차는 종일 LEAVE를 찍지 않는다. 나머지 반나절 출근하면 출근 처리가 PARTIAL_LEAVE로 기록한다 */
        if (request.isHalfDay) continue;
        try {
          /* 출근 기록이 있는 날은 시각·근무시간을 보존하고 상태만 바꾼다 */
          await db.execute(sql`
            INSERT INTO att_records (member_uid, date, status, work_mode)
            VALUES (${request.memberUid}, ${d}::date, 'LEAVE', NULL)
            ON CONFLICT (member_uid, date)
            DO UPDATE SET status = 'LEAVE', updated_at = NOW()
          `);
        } catch (innerErr) {
          console.warn(`[att-leave] LEAVE 반영 실패 ${d}:`, innerErr);
        }
      }
    } catch (err) {
      console.warn("[att-leave] 휴가 기간 LEAVE 반영 실패:", err);
    }
  }

  if (action === "REJECTED") {
    try {
      await db.execute(sql`
        DELETE FROM att_records
        WHERE member_uid = ${request.memberUid}
          AND date >= ${String(request.startDate)}::date
          AND date <= ${String(request.endDate)}::date
          AND status = 'LEAVE'
          AND check_in_time IS NULL
          AND check_out_time IS NULL
      `);
    } catch (err) {
      console.warn("[att-leave] LEAVE 복원 실패:", err);
    }
  }

  if (action === "CANCELLED") {
    const year = new Date(request.startDate).getFullYear();
    try {
      await db.execute(sql`
        UPDATE att_leave_balances
        SET used_days = GREATEST(0, used_days - ${request.days})
        WHERE member_uid = ${request.memberUid}
          AND leave_type_id = ${request.leaveTypeId}
          AND year = ${year}
      `);
    } catch (err) {
      console.warn("[att-leave] 연차 복원 실패:", err);
    }
    /* 실제 출근하지 않은 빈 LEAVE 행만 지운다 */
    try {
      await db.execute(sql`
        DELETE FROM att_records
        WHERE member_uid = ${request.memberUid}
          AND date >= ${String(request.startDate)}::date
          AND date <= ${String(request.endDate)}::date
          AND status = 'LEAVE'
          AND check_in_time IS NULL
          AND check_out_time IS NULL
      `);
    } catch (err) {
      console.warn("[att-leave] 취소 시 LEAVE 행 제거 실패:", err);
    }
  }

  try {
    const recipientId = Number(request.memberUid);
    if (Number.isFinite(recipientId) && recipientId > 0) {
      await sendWorkspaceNotification({
        memberId: recipientId,
        sourceType: "event" as any,
        sourceId: request.id,
        notifType: action === "APPROVED" ? "approved" : "rejected",
        channel: "bell",
        title: action === "APPROVED" ? "휴가 신청 승인" : action === "CANCELLED" ? "휴가 승인 취소" : "휴가 신청 반려",
        body: `${request.startDate} ~ ${request.endDate} (${request.days}일) — ${action === "APPROVED" ? "승인" : action === "CANCELLED" ? "승인 취소(연차 복원)" : "반려"}${note ? ` · ${String(note).slice(0, 100)}` : ""}`,
        actionUrl: "/workspace-attendance.html",
        category: "system",
      });
    }
  } catch (err) {
    console.warn("[att-leave] 결과 알림 실패:", err);
  }
  return updated;
}

/** 내부결재가 쓰는 휴가 처리. 신청 번호로 찾아 상태가 맞을 때만 처리한다. */
export async function decideLeaveById(leaveId: number, action: LeaveAction, reviewerId: number, note: string | null): Promise<void> {
  const [request] = await db.select().from(attLeaveRequests).where(eq(attLeaveRequests.id, leaveId)).limit(1);
  if (!request) return;
  if (action === "CANCELLED" ? request.status !== "APPROVED" : request.status !== "PENDING") return;
  await applyLeaveDecision(request, action, String(reviewerId), note);
}
