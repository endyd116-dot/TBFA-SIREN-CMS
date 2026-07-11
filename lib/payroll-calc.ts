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
import { REMOTE_REPORT_REQUIRED_FROM } from "./att-remote-policy";
import { taxableBaseOf } from "./payroll-breakdown";
import { getDefaultPolicy, PAY_DAY_GRACE_MINS } from "./att-utils";

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
  /** 2026-07-11 fix: 건너뛴 대상의 '누구를·왜'. 과거엔 숫자만 반환해 조용한 실패로 보였다. */
  skippedDetail: Array<{ memberUid: string; memberName: string; reason: string }>;
  errors: Array<{ memberUid: string; message: string }>;
  slipIds: number[];
}

export interface PayrollCalcOptions {
  /** REVIEWED 이상 상태도 강제로 덮어쓰기 (재집계 강제·기본 false) */
  force?: boolean;
  /** 특정 직원 1명만 재집계 (미지정 시 전원). 승인·발송 완료된 달에서 한 명의 근태 오류만
   *  바로잡을 때 사용 — 월 전체 강제 재집계가 다른 직원의 승인·수동수정까지 초기화하는 것을 막는다. */
  memberUid?: string | number;
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

/** 2026-06-03 Swain 모델: 그 달의 '영업일수'(분모) — 월~금(주말 제외), 공휴일은 빼지 않고 포함.
 *  일급 = (월급여) ÷ 이 값. 공휴일은 분모에 있지만 근무 안 하므로 자동 무급(5인 미만).
 *  예) 연봉 3,500 → 월급 ≈ 291.7만 ÷ 그달영업일수 = 일급. 실제 출근일 × 일급 = 지급액.
 *  (주6일 등 근무요일이 다르면 정책 확정 후 이 함수 조정) */
function businessDaysInMonth(year: number, month: number): number {
  const lastDay = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= lastDay; d++) {
    const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay(); // 0=일,6=토
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

export async function calculatePayrollForMonth(
  year: number,
  month: number,
  options: PayrollCalcOptions = {}
): Promise<PayrollCalcResult> {
  const force = !!options.force;
  const { first, last } = monthRange(year, month);
  const monthBusinessDays = businessDaysInMonth(year, month);   // 그 달 영업일수(분모·공휴일 포함)
  const q = quarterOfMonth(month);
  const settings = await loadPayrollSettings();

  /* 소정근로시간(하루 몇 시간) — 근태 정책에서. 지급일수를 근무시간으로 환산할 때의 기준(분모).
     정책을 못 읽으면 8시간으로 본다. */
  let dailyHours = 8;
  try {
    const pol = await getDefaultPolicy();
    if (pol?.dailyHours) dailyHours = Number(pol.dailyHours) || 8;
  } catch { /* 기본 8시간 */ }
  const stdMins = Math.max(1, Math.round(dailyHours * 60));
  /* 지급일수 구간 경계(분) — JS에서 미리 계산해 SQL엔 '완성된 숫자 하나'만 넘긴다.
     SQL 안에서 `파라미터 − 파라미터` 를 하면 Postgres가 타입을 추론하지 못해
     "operator is not unique: unknown - unknown" 으로 집계 전체가 실패한다(2026-07-12 실측). */
  const T100 = stdMins - PAY_DAY_GRACE_MINS;
  const T75  = stdMins * 0.75 - PAY_DAY_GRACE_MINS;
  const T50  = stdMins * 0.50 - PAY_DAY_GRACE_MINS;
  const T25  = stdMins * 0.25 - PAY_DAY_GRACE_MINS;

  const result: PayrollCalcResult = {
    year, month,
    candidateCount: 0,
    created: 0, updated: 0, skipped: 0,
    skippedDetail: [],
    errors: [], slipIds: [],
  };

  // 1. 후보 회원 — admin·또는 operatorActive 운영자·baseSalary>0·active
  /* 2026-05-29 P2-5 fix — hire_date 동봉. 월 중 입사 시 일할 적용. */
  const onlyUid = options.memberUid != null && String(options.memberUid) !== ""
    ? Number(options.memberUid) : null;
  const memberFilter = onlyUid && Number.isFinite(onlyUid) ? sql` AND id = ${onlyUid}` : sql``;
  let memberRows: any[];
  try {
    const r = await db.execute(sql`
      SELECT id, name, email, role, base_salary::numeric AS base_salary, hire_date
      FROM members
      WHERE status = 'active'
        AND (type = 'admin' OR operator_active = TRUE)
        AND COALESCE(base_salary, 0) > 0
        ${memberFilter}
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
      /* 2-1. att_records 집계 — 지급 대상 근무일수(working_days) 산정
         [2026-07-12 정책 전면 개정 · Swain]
           ① 지급일수는 '실제 근무시간'으로 정한다 (일급제라도 일한 만큼만).
              8시간↑ = 1.0 / 6~8시간 = 0.75(반반차) / 4~6시간 = 0.5(반차) / 2~4시간 = 0.25
              → 휴가 신청을 안 하고 일찍 퇴근해도 급여가 정확히 맞는다.
           ② 토·일·공휴일 출근은 지급일수에서 제외한다.
              일급의 분모(그 달 영업일수)에 주말이 없으므로, 분자에 넣으면 그대로 과지급된다.
              (2026-06-28 일요일 잘못 찍은 출근이 1일치로 지급되던 실제 사고)
              진짜 휴일근무 보상은 명세서 조정 라인으로 따로 지급한다.
           ③ 재택근무일에 보고서를 안 냈으면 그 날은 근무로 인정하지 않는다 (2026-07-01부터).
           ④ 퇴근을 안 찍어 근무시간을 모르는 날은 0으로 두고 별도 카운트 →
              명세서에 경고를 띄워 관리자가 정정하게 한다 (모르는 채로 지급/미지급하지 않는다).
         전일 유급휴가(연차 등)는 아래 2-2에서 따로 더한다. */
      const attRows = await db.execute(sql`
        SELECT
          -- 경계마다 유예 10분을 둔다 — 1분 모자라 25%가 깎이는 일이 없도록.
          COALESCE(SUM(
            CASE WHEN t.counts_for_pay THEN
              CASE
                WHEN t.working_mins >= ${T100} THEN 1.00
                WHEN t.working_mins >= ${T75}  THEN 0.75
                WHEN t.working_mins >= ${T50}  THEN 0.50
                WHEN t.working_mins >= ${T25}  THEN 0.25
                ELSE 0
              END
            ELSE 0 END
          ), 0)::numeric AS working_days,
          COALESCE(SUM(t.working_mins) FILTER (WHERE t.counts_for_pay), 0)::int AS working_mins,
          COALESCE(SUM(t.overtime_mins) FILTER (WHERE t.counts_for_pay), 0)::int AS overtime_mins,
          COUNT(*) FILTER (WHERE t.status = 'LATE')::int AS late_count,
          COUNT(*) FILTER (WHERE t.status = 'ABSENT')::int AS absent_count,
          COUNT(*) FILTER (WHERE t.unrecognized)::int AS unreported_remote_days,
          COUNT(*) FILTER (WHERE t.attended AND t.is_off_day)::int AS off_day_work_days,
          COUNT(*) FILTER (WHERE t.attended AND NOT t.is_off_day AND t.working_mins IS NULL)::int AS no_checkout_days,
          COUNT(*) FILTER (WHERE t.counts_for_pay AND t.working_mins < ${stdMins})::int AS short_days
        FROM (
          SELECT
            ar.status, ar.working_mins, ar.overtime_mins,
            /* 출근으로 기록된 날 */
            (ar.status IN ('NORMAL','LATE','EARLY_LEAVE','PARTIAL_LEAVE')) AS attended,
            /* 근무일이 아닌 날 (주말 · 공휴일) */
            (EXTRACT(DOW FROM ar.date) IN (0, 6) OR hol.id IS NOT NULL) AS is_off_day,
            /* 재택보고서 미제출 → 근무 불인정 */
            (ar.work_mode = 'REMOTE'
              AND ar.date >= ${REMOTE_REPORT_REQUIRED_FROM}::date
              AND ar.status IN ('NORMAL','LATE','EARLY_LEAVE','PARTIAL_LEAVE')
              AND rep.id IS NULL) AS unrecognized,
            /* 급여 지급일수로 셀 수 있는 날 */
            (ar.status IN ('NORMAL','LATE','EARLY_LEAVE','PARTIAL_LEAVE')
              AND EXTRACT(DOW FROM ar.date) NOT IN (0, 6)
              AND hol.id IS NULL
              AND ar.working_mins IS NOT NULL
              AND NOT (ar.work_mode = 'REMOTE'
                       AND ar.date >= ${REMOTE_REPORT_REQUIRED_FROM}::date
                       AND rep.id IS NULL)
            ) AS counts_for_pay
          FROM att_records ar
          LEFT JOIN att_holidays hol ON hol.date = ar.date
          LEFT JOIN att_remote_work_reports rep
            ON rep.member_uid = ar.member_uid
           AND rep.date = ar.date
           -- 정상 제출(SUBMITTED) + 관리자 예외 인정(EXEMPTED) 둘 다 '냈다'로 본다
           AND rep.status IN ('SUBMITTED', 'EXEMPTED')
          WHERE ar.member_uid = ${memberUid}
            AND ar.date >= ${first}::date
            AND ar.date <= ${last}::date
        ) t
      `);
      const att = ((attRows as any).rows || (attRows as any[]))[0] || {};
      const workingDays = Number(att.working_days || 0);
      const workingMins = Number(att.working_mins || 0);
      const overtimeMins = Number(att.overtime_mins || 0);
      const lateCount = Number(att.late_count || 0);
      const absentCount = Number(att.absent_count || 0);
      const unreportedRemoteDays = Number(att.unreported_remote_days || 0);
      const offDayWorkDays = Number(att.off_day_work_days || 0);        // 주말·공휴일 출근 (지급 제외)
      const noCheckoutDays = Number(att.no_checkout_days || 0);         // 퇴근 미기록 (근무시간 미확인)
      const shortDays = Number(att.short_days || 0);                    // 소정근로 미달 (0.25~0.75일치)

      /* 2-2. att_leave_requests 집계 (APPROVED·해당 월 시작일 기준)
         2026-07-12: 반차·반반차 같은 '하루 미만(부분) 휴가'는 지급일수에 더하지 않는다.
           그날 실제 근무시간으로 이미 0.5·0.75일치가 계산됐기 때문에, 여기서 또 더하면
           반나절만 일하고 하루치를 받는 과지급이 된다 (Swain 정책: 일한 만큼만).
           하루를 통째로 쉬는 유급휴가(연차 전일 등)만 여기서 더한다. */
      const leaveRows = await db.execute(sql`
        SELECT
          COALESCE(SUM(lr.days) FILTER (WHERE lt.is_paid = TRUE  AND lr.days >= 1), 0)::numeric AS paid_days,
          COALESCE(SUM(lr.days) FILTER (WHERE lt.is_paid = FALSE AND lr.days >= 1), 0)::numeric AS unpaid_days,
          COALESCE(SUM(lr.days) FILTER (WHERE lr.days < 1), 0)::numeric AS partial_days
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
      const partialLeaveDays = Number(leave.partial_days || 0);   // 반차·반반차 (근무시간으로 이미 반영)

      // Swain 2026-05-24: 급여 명세 대상 = 기본급 + 그달 근무실적 둘 다.
      // 기본급만 있고 해당 월 출퇴근·야근·휴가가 전혀 없으면 명세서 생성/갱신 제외
      // (운영 전 0원·무의미 명세서 방지). 기존 명세서가 있으면 보존(건드리지 않음).
      const hasActivity = workingDays > 0 || overtimeMins > 0 || paidLeaveDays > 0 || unpaidLeaveDays > 0
        || noCheckoutDays > 0 || offDayWorkDays > 0;
      if (!hasActivity) {
        result.skipped++;
        result.skippedDetail.push({
          memberUid, memberName: String(m.name ?? memberUid),
          reason: "그 달 출퇴근·휴가 기록이 없음 (명세서 생성 안 함)",
        });
        continue;
      }

      // 만근 — 근무일 1일 이상 + 지각·결근·무급휴가·소정근로 미달·재택 미제출·퇴근 미기록 전부 0
      const perfectAttendance =
        workingDays > 0 && lateCount === 0 && absentCount === 0 && unpaidLeaveDays === 0
        && unreportedRemoteDays === 0 && shortDays === 0 && noCheckoutDays === 0;

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

      // 3. 급여 구성 계산 — 2026-06-03 출근일 기반 일급제 (Swain 결정, 5인 미만 무급 공휴일)
      //   일급 = (연봉 ÷ 12) ÷ 월 표준근무일(payroll_settings.monthlyWorkDays).
      //   기본급 = (실제 출근일 + 유급휴가일) × 일급.  유급휴가는 지급일에 포함.
      //   공휴일·결근·무급휴가는 '출근일'이 아니므로 자동으로 미지급(무급) — 월급제 일할(proration) 불필요.
      //   (만근 시 출근일 ≈ monthlyWorkDays 라 기본급 ≈ 월급으로 수렴.)
      //   일급 = 월급여(연봉/12) ÷ 그 달 영업일수(공휴일 포함). 영업일수 0인 비정상 달은 설정값으로 폴백.
      const dailyWage = (baseSalary / 12) / (monthBusinessDays || settings.monthlyWorkDays);
      const paidDays = workingDays + paidLeaveDays;
      const baseSalaryMonth = paidDays * dailyWage;
      const hourly = 0;                                      // 2026-06-03: 야근시스템 없음 — 시급/야근단가 미사용
      const overtimePay = 0;                                 // 야근수당 미운영(항상 0)
      const deductionUnpaid = 0;                              // 일급제: 무급일은 출근일에서 제외돼 자동 미지급(별도 공제 라인 없음)
      const performanceBonus = quarterTotalBonus / 3;         // 분기 3개월 균등 안분
      const perfectBonus = 0;                                 // 만근 보너스 정책 미정의 (이번 범위 외)
      const grossPay = baseSalaryMonth + performanceBonus + perfectBonus;  // 야근·무급차감 제외

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
        att: {
          workingDays, workingMins, overtimeMins, lateCount, absentCount,
          unreportedRemoteDays,
          offDayWorkDays,    // 주말·공휴일 출근 (지급 제외)
          noCheckoutDays,    // 퇴근 미기록 (근무시간 미확인 → 지급 0, 정정 필요)
          shortDays,         // 소정근로 미달 (0.25~0.75일치로 계산된 날)
          dailyHours,        // 소정근로시간 (지급일수 환산 기준)
        },
        leave: { paidLeaveDays, unpaidLeaveDays, partialLeaveDays },
        perfectAttendance,
        quarter: { year, q, totalBonusPaid: quarterTotalBonus },
        derived: {
          hourly: r2(hourly),
          dailyWage: r2(dailyWage),              // 일급 (월급여 ÷ 그달 영업일수)
          monthBusinessDays,                     // 그 달 영업일수 (분모·공휴일 포함)
          paidDays,                              // 지급 대상일 (출근일 + 유급휴가일)
          baseSalaryMonth: r2(baseSalaryMonth),
          overtimePay: r2(overtimePay),
          deductionUnpaid: r2(deductionUnpaid),
          performanceBonus: r2(performanceBonus),
          perfectBonus,
          /* R41 Q3-052: force 재집계 시 조정분(ADD/DEDUCT)·기타공제를 스냅샷에 기록(기본 0).
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
        /* 확정 단계(검토완료·승인·발송·지급)와 어드민이 금액을 직접 손댄 명세서만 재집계가 보존한다.
           2026-07-11 fix: 여기 있던 '보류(HOLD)'를 뺐다.
             보류는 "지급 확정 전, 뭔가 이상해서 멈춰둔 상태"다. 실제 운영 흐름은
             '급여 이상함 → 보류 → 근태 정정 받아 수정 → 재집계'인데, 보류를 잠가버리니
             재집계가 그 명세서만 조용히 건너뛰고 화면엔 "재집계 완료"만 떠서
             근태를 고쳐도 급여가 옛날 숫자에 멈춰 있었다(2026-06 실제 발생·출근 7일 vs 실제 13일).
             유일한 대안인 '강제 재집계'는 그 달 전원의 승인·발송·수동수정까지 초기화해 쓸 수 없었다.
           P1-31이 막으려던 것은 '보류가 조용히 초안(DRAFT)으로 풀리는 것'이었으므로,
           아래에서 금액·근태만 최신화하고 상태는 계속 보류로 유지해 그 의도는 그대로 지킨다. */
        const lockable = ["REVIEWED", "APPROVED", "SENT", "PAID"].includes(existingRow.status)
          || existingRow.manually_edited === true;
        if (lockable && !force) {
          result.skipped++;
          result.slipIds.push(Number(existingRow.id));
          const STATUS_LABEL: Record<string, string> = {
            REVIEWED: "검토 완료", APPROVED: "승인됨", SENT: "발송됨", PAID: "지급 완료",
          };
          result.skippedDetail.push({
            memberUid, memberName: String(m.name ?? memberUid),
            reason: existingRow.manually_edited === true
              ? "금액을 직접 수정한 명세서"
              : (STATUS_LABEL[String(existingRow.status)] ?? String(existingRow.status)),
          });
          continue;
        }
        /* 보류 명세서는 숫자만 최신화하고 '보류' 표시를 유지 (강제 재집계는 초안으로 되돌림). */
        const keepHold = !force && String(existingRow.status) === "HOLD";
        const nextStatus = keepHold ? "HOLD" : "DRAFT";
        /* P1-16 fix: force 재집계가 기본 구성요소만 다시 계산하고 어드민이 추가한 조정라인
           (adjustments)·기타공제(other_deduction)는 컬럼에 남겨두면서 gross/net 합계엔 반영 안 해
           "라인은 보이는데 세전·실수령엔 빠진" 모순이 생긴다. 편집 공식(admin-payroll.ts)과 동일하게
           기존 조정분을 합계에 접어 넣어 일관성 유지(조정라인·기타공제 컬럼은 그대로 보존). */
        const _adjArr = Array.isArray(existingRow.adjustments) ? existingRow.adjustments : [];
        const _adjAdd = _adjArr.filter((a: any) => a?.kind !== "DEDUCT").reduce((s: number, a: any) => s + (Number(a?.amount) || 0), 0);
        const _adjDeduct = _adjArr.filter((a: any) => a?.kind === "DEDUCT").reduce((s: number, a: any) => s + (Number(a?.amount) || 0), 0);
        const _otherDeduction = Number(existingRow.other_deduction || 0);
        const grossPayFinal = grossPay + _adjAdd - _adjDeduct;

        /* 2026-07-12: 4대보험·소득세를 '과세 대상액'(세전 − 비과세 지급액) 기준으로 다시 계산한다.
           과거엔 조정 라인을 세전에만 더하고 공제는 그대로 둬서, 명세서에 적힌 계산방법
           ("세전 총액 × 4.5%")과 실제 공제액이 서로 맞지 않았다 — 서명받는 문서에선 치명적.
           성과금을 더하면 보험료도 그만큼 늘고, 비과세로 지정한 차량지원 등은 산정에서 빠진다. */
        const _taxableBase = taxableBaseOf({ adjustments: _adjArr }, grossPayFinal);
        const dedFinal = computeDeductions(_taxableBase, settings);
        const totalDeductionFinal =
          dedFinal.nationalPension + dedFinal.healthInsurance + dedFinal.longTermCare +
          dedFinal.employmentInsurance + dedFinal.incomeTax + dedFinal.localTax + _otherDeduction;
        const netPayFinal = grossPayFinal - totalDeductionFinal;

        /* Q3-052 fix: 저장 컬럼(gross_pay/net_pay)은 조정분 반영(Final)인데 snapshot.derived는 조정 전 값이라
           둘이 어긋났다. 스냅샷의 합계를 실제 저장값과 일치시키고 조정분도 함께 기록(감사 추적 정합). */
        snapshot.derived.adjustmentAdd = r2(_adjAdd);
        snapshot.derived.adjustmentDeduct = r2(_adjDeduct);
        snapshot.derived.otherDeduction = r2(_otherDeduction);
        snapshot.derived.grossPay = r2(grossPayFinal);
        snapshot.derived.deductions = {
          nationalPension: r2(dedFinal.nationalPension),
          healthInsurance: r2(dedFinal.healthInsurance),
          longTermCare: r2(dedFinal.longTermCare),
          employmentInsurance: r2(dedFinal.employmentInsurance),
          incomeTax: r2(dedFinal.incomeTax),
          localTax: r2(dedFinal.localTax),
          totalDeduction: r2(totalDeductionFinal),
        };
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
            national_pension = ${r2(dedFinal.nationalPension)},
            health_insurance = ${r2(dedFinal.healthInsurance)},
            long_term_care = ${r2(dedFinal.longTermCare)},
            employment_insurance = ${r2(dedFinal.employmentInsurance)},
            income_tax = ${r2(dedFinal.incomeTax)},
            local_tax = ${r2(dedFinal.localTax)},
            total_deduction = ${r2(totalDeductionFinal)},
            net_pay = ${r2(netPayFinal)},
            calculation_snapshot = ${JSON.stringify(snapshot)}::jsonb,
            status = ${nextStatus},
            -- P2-51 fix: 재집계로 '자동 계산 초안'으로 되돌리므로 수동수정 표식·승인/발송/지급 일자도 함께 초기화.
            --            (과거: 표식이 남아 이후 일반 재집계가 그 직원만 영구 skip, 초안인데 지급확정일이 표시되던 모순)
            manually_edited = FALSE,
            approved_by = NULL, approved_at = NULL,
            sent_at = NULL,
            paid_by = NULL, paid_at = NULL,
            -- 2026-07-11: 금액이 다시 계산됐으므로 교부해둔 고정 문서는 더 이상 이 명세서의 내용이 아니다.
            --   버려야 다시 발송할 때 새 문서(정정 차수)가 만들어진다. 안 버리면 옛 PDF가 그대로 재발송된다.
            --   이미 받아둔 서명도 '바뀌기 전 문서'에 대한 것이므로 수령확인을 다시 받는다.
            --   (지난 서명 증적은 payroll_acknowledgments에 그대로 남아 감사 추적이 끊기지 않는다)
            document_r2_key = NULL,
            document_sha256 = NULL,
            signed_document_r2_key = NULL,
            ack_status = 'PENDING',
            ack_at = NULL,
            first_viewed_at = NULL,
            reminder_count = 0,
            reminder_sent_at = NULL,
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
