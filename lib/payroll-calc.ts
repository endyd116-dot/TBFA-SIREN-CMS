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

/* === 급여 고도화 (2026-05-20): 계산 기준 + 공제 === */
export interface PayrollSettings {
  overtimeMultiplier: number; annualHours: number; monthlyWorkDays: number;
  pensionRate: number; healthRate: number; longtermRate: number;
  employmentRate: number; incomeTaxRate: number;
}
const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
  overtimeMultiplier: 1.5, annualHours: 2080, monthlyWorkDays: 22,
  pensionRate: 0.045, healthRate: 0.03545, longtermRate: 0.1295,
  employmentRate: 0.009, incomeTaxRate: 0,
};

/** payroll_settings(id=1) 로드 — 행 없으면 기본값. */
export async function loadPayrollSettings(): Promise<PayrollSettings> {
  try {
    const r = await db.execute(sql`SELECT * FROM payroll_settings WHERE id = 1 LIMIT 1`);
    const row = (r as any).rows?.[0] || (r as any[])[0];
    if (!row) return { ...DEFAULT_PAYROLL_SETTINGS };
    return {
      overtimeMultiplier: Number(row.overtime_multiplier ?? 1.5),
      annualHours:        Number(row.annual_hours ?? 2080),
      monthlyWorkDays:    Number(row.monthly_work_days ?? 22),
      pensionRate:        Number(row.pension_rate ?? 0.045),
      healthRate:         Number(row.health_rate ?? 0.03545),
      longtermRate:       Number(row.longterm_rate ?? 0.1295),
      employmentRate:     Number(row.employment_rate ?? 0.009),
      incomeTaxRate:      Number(row.income_tax_rate ?? 0),
    };
  } catch { return { ...DEFAULT_PAYROLL_SETTINGS }; }
}

/** 세전총액 기준 법정 공제 자동 산출 (장기요양=건강보험액×요율·지방세=소득세×10%). */
export function computeDeductions(gross: number, s: PayrollSettings) {
  const nationalPension = gross * s.pensionRate;
  const healthInsurance = gross * s.healthRate;
  const longTermCare = healthInsurance * s.longtermRate;
  const employmentInsurance = gross * s.employmentRate;
  const incomeTax = gross * s.incomeTaxRate;
  const localTax = incomeTax * 0.1;
  return { nationalPension, healthInsurance, longTermCare, employmentInsurance, incomeTax, localTax };
}

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
  const settings = await loadPayrollSettings();

  const result: PayrollCalcResult = {
    year, month,
    candidateCount: 0,
    created: 0, updated: 0, skipped: 0,
    errors: [], slipIds: [],
  };

  // 1. 후보 회원 — admin·또는 operatorActive 운영자·baseSalary>0·active
  /* 2026-05-29 P2-5 fix — hire_date 동봉. 월 중 입사 시 일할 적용. */
  let memberRows: any[];
  try {
    const r = await db.execute(sql`
      SELECT id, name, email, role, base_salary::numeric AS base_salary, hire_date
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

      // ★ Swain 2026-05-24: 급여 명세 대상 = 기본급 + 그달 근무실적 둘 다.
      // 기본급만 있고 해당 월 출퇴근·야근·휴가가 전혀 없으면 명세서 생성/갱신 제외
      // (운영 전 0원·무의미 명세서 방지). 기존 명세서가 있으면 보존(건드리지 않음).
      const hasActivity = workingDays > 0 || overtimeMins > 0 || paidLeaveDays > 0 || unpaidLeaveDays > 0;
      if (!hasActivity) {
        result.skipped++;
        continue;
      }

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

      // 3. 급여 구성 계산 — ★ 2026-06-03 출근일 기반 일급제 (Swain 결정, 5인 미만 무급 공휴일)
      //   일급 = (연봉 ÷ 12) ÷ 월 표준근무일(payroll_settings.monthlyWorkDays).
      //   기본급 = (실제 출근일 + 유급휴가일) × 일급.  유급휴가는 지급일에 포함.
      //   공휴일·결근·무급휴가는 '출근일'이 아니므로 자동으로 미지급(무급) — 월급제 일할(proration) 불필요.
      //   (만근 시 출근일 ≈ monthlyWorkDays 라 기본급 ≈ 월급으로 수렴.)
      const dailyWage = (baseSalary / 12) / settings.monthlyWorkDays;
      const paidDays = workingDays + paidLeaveDays;
      const baseSalaryMonth = paidDays * dailyWage;
      const hourly = baseSalary / settings.annualHours;       // 연 기준시간 시급(야근 단가)
      const overtimePay = (overtimeMins / 60) * hourly * settings.overtimeMultiplier;
      const deductionUnpaid = 0;                              // 일급제: 무급일은 출근일에서 제외돼 자동 미지급(별도 공제 라인 없음)
      const performanceBonus = quarterTotalBonus / 3;         // 분기 3개월 균등 안분
      const perfectBonus = 0;                                 // 만근 보너스 정책 미정의 (이번 범위 외)
      const grossPay = baseSalaryMonth + overtimePay - deductionUnpaid + performanceBonus + perfectBonus;

      // 3-2. 공제·실수령 (4대보험 요율 자동 + 소득세 정률 + 지방세 10%)
      const ded = computeDeductions(grossPay, settings);
      const totalDeduction =
        ded.nationalPension + ded.healthInsurance + ded.longTermCare +
        ded.employmentInsurance + ded.incomeTax + ded.localTax;
      const netPay = grossPay - totalDeduction;

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
          dailyWage: r2(dailyWage),              // 일급 (연봉/12/월표준근무일)
          paidDays,                              // 지급 대상일 (출근일 + 유급휴가일)
          baseSalaryMonth: r2(baseSalaryMonth),
          overtimePay: r2(overtimePay),
          deductionUnpaid: r2(deductionUnpaid),
          performanceBonus: r2(performanceBonus),
          perfectBonus,
          /* ★ R41 Q3-052: force 재집계 시 조정분(ADD/DEDUCT)·기타공제를 스냅샷에 기록(기본 0).
             아래 force 분기에서 실제값으로 덮어써 저장 컬럼(grossPayFinal/netPayFinal)과 정합 유지. */
          adjustmentAdd: 0,
          adjustmentDeduct: 0,
          otherDeduction: 0,
          grossPay: r2(grossPay),
          deductions: {
            nationalPension: r2(ded.nationalPension),
            healthInsurance: r2(ded.healthInsurance),
            longTermCare: r2(ded.longTermCare),
            employmentInsurance: r2(ded.employmentInsurance),
            incomeTax: r2(ded.incomeTax),
            localTax: r2(ded.localTax),
            totalDeduction: r2(totalDeduction),
          },
          netPay: r2(netPay),
        },
        settings,
        calculatedAt: new Date().toISOString(),
      };

      // 5. UPSERT — 기존 status≥REVIEWED은 force=false면 보존 (skip)
      const existing = await db.execute(sql`
        SELECT id, status, manually_edited, adjustments, other_deduction FROM payroll_slips
        WHERE member_uid = ${memberUid} AND pay_year = ${year} AND pay_month = ${month}
        LIMIT 1
      `);
      const existingRow = ((existing as any).rows || (existing as any[]))[0];

      if (existingRow) {
        // REVIEWED 이상·PAID·수동 수정된 슬립은 재집계가 덮지 않음 (force 제외)
        const lockable = ["REVIEWED", "APPROVED", "SENT", "PAID"].includes(existingRow.status)
          || existingRow.manually_edited === true;
        if (lockable && !force) {
          result.skipped++;
          result.slipIds.push(Number(existingRow.id));
          continue;
        }
        /* ★ P1-16 fix: force 재집계가 기본 구성요소만 다시 계산하고 어드민이 추가한 조정라인
           (adjustments)·기타공제(other_deduction)는 컬럼에 남겨두면서 gross/net 합계엔 반영 안 해
           "라인은 보이는데 세전·실수령엔 빠진" 모순이 생긴다. 편집 공식(admin-payroll.ts)과 동일하게
           기존 조정분을 합계에 접어 넣어 일관성 유지(조정라인·기타공제 컬럼은 그대로 보존). */
        const _adjArr = Array.isArray(existingRow.adjustments) ? existingRow.adjustments : [];
        const _adjAdd = _adjArr.filter((a: any) => a?.kind === "ADD").reduce((s: number, a: any) => s + (Number(a?.amount) || 0), 0);
        const _adjDeduct = _adjArr.filter((a: any) => a?.kind === "DEDUCT").reduce((s: number, a: any) => s + (Number(a?.amount) || 0), 0);
        const _otherDeduction = Number(existingRow.other_deduction || 0);
        const grossPayFinal = grossPay + _adjAdd - _adjDeduct;
        const totalDeductionFinal = totalDeduction + _otherDeduction;
        const netPayFinal = grossPayFinal - totalDeductionFinal;
        /* ★ Q3-052 fix: 저장 컬럼(gross_pay/net_pay)은 조정분 반영(Final)인데 snapshot.derived는 조정 전 값이라
           둘이 어긋났다. 스냅샷의 합계를 실제 저장값과 일치시키고 조정분도 함께 기록(감사 추적 정합). */
        snapshot.derived.adjustmentAdd = r2(_adjAdd);
        snapshot.derived.adjustmentDeduct = r2(_adjDeduct);
        snapshot.derived.otherDeduction = r2(_otherDeduction);
        snapshot.derived.grossPay = r2(grossPayFinal);
        snapshot.derived.deductions.totalDeduction = r2(totalDeductionFinal);
        snapshot.derived.netPay = r2(netPayFinal);
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
            gross_pay = ${r2(grossPayFinal)},
            national_pension = ${r2(ded.nationalPension)},
            health_insurance = ${r2(ded.healthInsurance)},
            long_term_care = ${r2(ded.longTermCare)},
            employment_insurance = ${r2(ded.employmentInsurance)},
            income_tax = ${r2(ded.incomeTax)},
            local_tax = ${r2(ded.localTax)},
            total_deduction = ${r2(totalDeductionFinal)},
            net_pay = ${r2(netPayFinal)},
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
            national_pension, health_insurance, long_term_care, employment_insurance, income_tax, local_tax, total_deduction, net_pay,
            status, calculation_snapshot
          ) VALUES (
            ${memberUid}, ${year}, ${month},
            ${workingDays}, ${workingMins}, ${overtimeMins}, ${lateCount}, ${absentCount},
            ${paidLeaveDays}, ${unpaidLeaveDays}, ${perfectAttendance},
            ${r2(baseSalaryMonth)}, ${r2(overtimePay)}, ${r2(deductionUnpaid)}, ${r2(performanceBonus)}, ${r2(perfectBonus)}, ${r2(grossPay)},
            ${r2(ded.nationalPension)}, ${r2(ded.healthInsurance)}, ${r2(ded.longTermCare)}, ${r2(ded.employmentInsurance)}, ${r2(ded.incomeTax)}, ${r2(ded.localTax)}, ${r2(totalDeduction)}, ${r2(netPay)},
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
