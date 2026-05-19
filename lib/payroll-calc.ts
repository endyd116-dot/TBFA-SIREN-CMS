// lib/payroll-calc.ts
// R37 자동 집계 헬퍼.
// cron-payroll-monthly + admin-payroll POST recalculate 공유 로직.
//
// 입력: year, month (집계 대상 연·월 — 직전 달 또는 슈퍼어드민 지정)
// 동작:
//  1. members SELECT (type='admin' or operatorActive=true, status='active', baseSalary > 0)
//  2. 각 회원에 대해 att_records·att_leave_requests·quarterly_settlements 집계
//  3. 급여 구성 계산 (base/overtime/deduction/performance/perfect)
//  4. payroll_slips UPSERT (DRAFT 상태일 때만 갱신·REVIEWED 이상은 보존)
//  5. calculation_snapshot에 모든 입력값 JSON 보존
//
// 반환: { created, updated, skipped, errors, slipIds }
import { db } from "../db";
import { sql } from "drizzle-orm";

export interface PayrollCalcResult {
  year: number;
  month: number;
  candidateCount: number;
  created: number;
  updated: number;
  skipped: number;          // 이미 REVIEWED 이상이라 보존된 케이스
  errors: Array<{ memberUid: string; message: string }>;
  slipIds: number[];
}

export interface PayrollCalcOptions {
  /** REVIEWED 이상 상태도 강제로 덮어쓰기 (재집계 강제·기본 false) */
  force?: boolean;
}

/** 분기 계산: 1·2·3 → 1, 4·5·6 → 2, ... */
function quarterOfMonth(month: number): number {
  return Math.ceil(month / 3);
}

/** YYYY-MM-DD 형식의 시작/끝 일자 (해당 월의 first/last day) */
function monthRange(year: number, month: number): { first: string; last: string } {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const last = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { first, last };
}

export async function calculatePayrollForMonth(
  year: number,
  month: number,
  options: PayrollCalcOptions = {}
): Promise<PayrollCalcResult> {
  const force = !!options.force;
  const { first, last } = monthRange(year, month);
  const q = quarterOfMonth(month);

  const result: PayrollCalcResult = {
    year, month,
    candidateCount: 0,
    created: 0, updated: 0, skipped: 0,
    errors: [], slipIds: [],
  };

  // 1. 후보 회원 — admin·또는 operatorActive 운영자·baseSalary>0·active
  let memberRows: any[];
  try {
    const r = await db.execute(sql`
      SELECT id, name, email, role, base_salary::numeric AS base_salary
      FROM members
      WHERE status = 'active'
        AND (type = 'admin' OR operator_active = TRUE)
        AND COALESCE(base_salary, 0) > 0
      ORDER BY id
    `);
    memberRows = (r as any).rows || (r as any[]) || [];
  } catch (err: any) {
    result.errors.push({ memberUid: "*", message: `member_select_failed: ${err?.message || err}` });
    return result;
  }

  result.candidateCount = memberRows.length;
  if (memberRows.length === 0) return result;

  for (const m of memberRows) {
    const memberUid = String(m.id);
    const baseSalary = Number(m.base_salary || 0);

    try {
      // 2-1. att_records 집계
      const attRows = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('NORMAL','LATE','EARLY_LEAVE','PARTIAL_LEAVE'))::int AS working_days,
          COALESCE(SUM(working_mins) FILTER (WHERE working_mins IS NOT NULL), 0)::int AS working_mins,
          COALESCE(SUM(overtime_mins), 0)::int AS overtime_mins,
          COUNT(*) FILTER (WHERE status = 'LATE')::int AS late_count,
          COUNT(*) FILTER (WHERE status = 'ABSENT')::int AS absent_count
        FROM att_records
        WHERE member_uid = ${memberUid}
          AND date >= ${first}::date
          AND date <= ${last}::date
      `);
      const att = ((attRows as any).rows || (attRows as any[]))[0] || {};
      const workingDays = Number(att.working_days || 0);
      const workingMins = Number(att.working_mins || 0);
      const overtimeMins = Number(att.overtime_mins || 0);
      const lateCount = Number(att.late_count || 0);
      const absentCount = Number(att.absent_count || 0);

      // 2-2. att_leave_requests 집계 (APPROVED·해당 월 시작일 기준)
      const leaveRows = await db.execute(sql`
        SELECT
          COALESCE(SUM(lr.days) FILTER (WHERE lt.is_paid = TRUE), 0)::numeric AS paid_days,
          COALESCE(SUM(lr.days) FILTER (WHERE lt.is_paid = FALSE), 0)::numeric AS unpaid_days
        FROM att_leave_requests lr
        LEFT JOIN att_leave_types lt ON lt.id = lr.leave_type_id
        WHERE lr.member_uid = ${memberUid}
          AND lr.status = 'APPROVED'
          AND lr.start_date >= ${first}::date
          AND lr.start_date <= ${last}::date
      `);
      const leave = ((leaveRows as any).rows || (leaveRows as any[]))[0] || {};
      const paidLeaveDays = Number(leave.paid_days || 0);
      const unpaidLeaveDays = Number(leave.unpaid_days || 0);

      // 만근 — 근무일 1일 이상 + 지각·결근·무급 휴가 0
      const perfectAttendance =
        workingDays > 0 && lateCount === 0 && absentCount === 0 && unpaidLeaveDays === 0;

      // 2-3. quarterly_settlements 집계 (해당 월이 속한 분기·PAID·members.id 기준)
      const qsRows = await db.execute(sql`
        SELECT COALESCE(SUM(qs.total_bonus::numeric), 0)::numeric AS total_bonus
        FROM quarterly_settlements qs
        JOIN quarters q ON q.id = qs.quarter_id
        WHERE qs.member_id = ${Number(memberUid)}
          AND qs.status = 'PAID'
          AND q.year = ${year}
          AND q.quarter = ${q}
      `);
      const qs = ((qsRows as any).rows || (qsRows as any[]))[0] || {};
      const quarterTotalBonus = Number(qs.total_bonus || 0);

      // 3. 급여 구성 계산
      const baseSalaryMonth = baseSalary / 12;
      const hourly = baseSalary / 2080;                       // 연 2080시간 기준 시급
      const overtimePay = (overtimeMins / 60) * hourly * 1.5;
      const deductionUnpaid = unpaidLeaveDays * (baseSalaryMonth / 22);
      const performanceBonus = quarterTotalBonus / 3;         // 분기 3개월 균등 안분
      const perfectBonus = 0;                                 // 만근 보너스 정책 미정의 (회귀 위험 §10)
      const grossPay = baseSalaryMonth + overtimePay - deductionUnpaid + performanceBonus + perfectBonus;

      // 4. 4-자리 반올림
      const r2 = (n: number) => Math.round(n * 100) / 100;

      const snapshot = {
        memberId: Number(memberUid),
        memberName: m.name,
        baseSalary,
        att: { workingDays, workingMins, overtimeMins, lateCount, absentCount },
        leave: { paidLeaveDays, unpaidLeaveDays },
        perfectAttendance,
        quarter: { year, q, totalBonusPaid: quarterTotalBonus },
        derived: {
          hourly: r2(hourly),
          baseSalaryMonth: r2(baseSalaryMonth),
          overtimePay: r2(overtimePay),
          deductionUnpaid: r2(deductionUnpaid),
          performanceBonus: r2(performanceBonus),
          perfectBonus,
          grossPay: r2(grossPay),
        },
        calculatedAt: new Date().toISOString(),
      };

      // 5. UPSERT — 기존 status≥REVIEWED은 force=false면 보존 (skip)
      const existing = await db.execute(sql`
        SELECT id, status FROM payroll_slips
        WHERE member_uid = ${memberUid} AND pay_year = ${year} AND pay_month = ${month}
        LIMIT 1
      `);
      const existingRow = ((existing as any).rows || (existing as any[]))[0];

      if (existingRow) {
        const lockable = ["REVIEWED", "APPROVED", "SENT"].includes(existingRow.status);
        if (lockable && !force) {
          result.skipped++;
          result.slipIds.push(Number(existingRow.id));
          continue;
        }
        // 갱신
        const upd = await db.execute(sql`
          UPDATE payroll_slips SET
            working_days = ${workingDays},
            working_mins = ${workingMins},
            overtime_mins = ${overtimeMins},
            late_count = ${lateCount},
            absent_count = ${absentCount},
            paid_leave_days = ${paidLeaveDays},
            unpaid_leave_days = ${unpaidLeaveDays},
            perfect_attendance = ${perfectAttendance},
            base_salary_month = ${r2(baseSalaryMonth)},
            overtime_pay = ${r2(overtimePay)},
            deduction_unpaid = ${r2(deductionUnpaid)},
            performance_bonus = ${r2(performanceBonus)},
            perfect_bonus = ${r2(perfectBonus)},
            gross_pay = ${r2(grossPay)},
            calculation_snapshot = ${JSON.stringify(snapshot)}::jsonb,
            status = 'DRAFT',
            updated_at = NOW()
          WHERE id = ${Number(existingRow.id)}
          RETURNING id
        `);
        const updRow = ((upd as any).rows || (upd as any[]))[0];
        if (updRow) {
          result.updated++;
          result.slipIds.push(Number(updRow.id));
        }
      } else {
        // 신규
        const ins = await db.execute(sql`
          INSERT INTO payroll_slips (
            member_uid, pay_year, pay_month,
            working_days, working_mins, overtime_mins, late_count, absent_count,
            paid_leave_days, unpaid_leave_days, perfect_attendance,
            base_salary_month, overtime_pay, deduction_unpaid, performance_bonus, perfect_bonus, gross_pay,
            status, calculation_snapshot
          ) VALUES (
            ${memberUid}, ${year}, ${month},
            ${workingDays}, ${workingMins}, ${overtimeMins}, ${lateCount}, ${absentCount},
            ${paidLeaveDays}, ${unpaidLeaveDays}, ${perfectAttendance},
            ${r2(baseSalaryMonth)}, ${r2(overtimePay)}, ${r2(deductionUnpaid)}, ${r2(performanceBonus)}, ${r2(perfectBonus)}, ${r2(grossPay)},
            'DRAFT', ${JSON.stringify(snapshot)}::jsonb
          )
          RETURNING id
        `);
        const insRow = ((ins as any).rows || (ins as any[]))[0];
        if (insRow) {
          result.created++;
          result.slipIds.push(Number(insRow.id));
        }
      }
    } catch (err: any) {
      result.errors.push({
        memberUid,
        message: String(err?.message || err).slice(0, 200),
      });
    }
  }

  return result;
}

/** "직전 달"(KST 기준) 연·월 산출 헬퍼. */
export function previousMonthKST(now: Date = new Date()): { year: number; month: number } {
  // KST = UTC+9
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;             // 1-12
  // 직전 달
  if (m === 1) return { year: y - 1, month: 12 };
  return { year: y, month: m - 1 };
}
