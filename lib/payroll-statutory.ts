// lib/payroll-statutory.ts
// 법정 신고 자료 — 임금대장 · 원천징수이행상황신고 · 연말정산 집계 · 4대보험 보수총액.
//
// 왜 필요한가:
//   급여에서 소득세·지방소득세를 떼기 시작하면, 뗀 돈은 협회 돈이 아니라 '국가에 대신 내주는 돈'이다.
//   매달 신고·납부해야 하고, 연말에는 1년치를 정산해 제출해야 한다.
//   주민등록번호는 시스템에 두지 않는다(유출 위험·보호 의무) — 신고서에 옮겨 적을 '숫자'만 만든다.
//
// ⚠️ 집계 기준이 자료마다 다르다. 섞으면 신고가 틀린다.
//   · 임금대장 / 연말정산 집계 / 4대보험 보수총액 → **귀속월** (그 달의 근로에 대한 임금)
//   · 원천징수이행상황신고            → **지급일** (실제로 돈이 나간 날)
//     예) 6월 근로분 급여를 7월 25일에 지급 → 7월 지급분 → 8월 10일까지 신고
//
// ⚠️ 과세 대상액 = 세전 총액 − 비과세 지급액(자가운전보조금 등).
//   4대보험·소득세는 전부 이 금액이 기준이고, 신고서의 '총지급액'도 비과세를 뺀 금액이다.

import { db } from "../db/index";
import { sql } from "drizzle-orm";
import { taxableBaseOf, nonTaxableTotalOf, positionLabelOf } from "./payroll-breakdown";

/** 법정 서류에 담는 명세서 — 초안·검토 중인 건 확정 전이라 제외한다 */
const CONFIRMED = ["APPROVED", "SENT", "PAID"];

const n = (v: any) => Number(v ?? 0) || 0;
const rows = (r: any) => ((r as any).rows ?? r ?? []) as any[];

export interface StatutorySlip {
  slipId: number;
  memberUid: number;
  name: string;
  position: string;
  hireDate: string | null;
  status: string;
  payYear: number;
  payMonth: number;
  paidAt: string | null;

  workingDays: number;
  workingMins: number;
  overtimeMins: number;

  /* 지급 */
  baseSalary: number;        // 기본급
  overtimePay: number;       // 연장근로수당
  performanceBonus: number;  // 성과금
  perfectBonus: number;      // 만근수당
  adjustTaxable: number;     // 조정(과세)
  adjustNonTaxable: number;  // 조정(비과세)
  adjustDeduct: number;      // 조정(차감)
  grossPay: number;          // 지급 총액
  nonTaxable: number;        // 비과세 합계
  taxableBase: number;       // 과세 대상액 = grossPay − nonTaxable

  /* 공제 */
  nationalPension: number;
  healthInsurance: number;
  longTermCare: number;
  employmentInsurance: number;
  incomeTax: number;
  localTax: number;
  otherDeduction: number;
  totalDeduction: number;

  netPay: number;            // 실지급액
}

/** 명세서 원본 → 신고 자료용 한 줄 (지급·공제 항목을 법정 서류 항목으로 펼친다) */
function toStatutorySlip(r: any): StatutorySlip {
  const adjustments = Array.isArray(r.adjustments) ? r.adjustments : [];
  const slipLike = { adjustments };

  const grossPay = n(r.gross_pay);
  const nonTaxable = nonTaxableTotalOf(slipLike);
  const taxableBase = taxableBaseOf(slipLike, grossPay);

  /* 조정 라인을 과세·비과세·차감으로 갈라 담는다 (임금대장은 항목별 금액을 요구한다) */
  let adjustTaxable = 0, adjustNonTaxable = 0, adjustDeduct = 0;
  for (const a of adjustments) {
    const amt = n(a?.amount);
    if (a?.kind === "DEDUCT") adjustDeduct += amt;
    else if (a?.taxable === false) adjustNonTaxable += amt;
    else adjustTaxable += amt;
  }

  return {
    slipId: Number(r.id),
    memberUid: Number(r.member_uid),
    name: r.m_name ?? `회원ID:${r.member_uid}`,
    position: positionLabelOf({ position: r.m_position, milestoneRole: r.m_milestone_role, role: r.m_role }),
    hireDate: r.m_hire_date ? String(r.m_hire_date).slice(0, 10) : null,
    status: String(r.status),
    payYear: Number(r.pay_year),
    payMonth: Number(r.pay_month),
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,

    workingDays: n(r.working_days),
    workingMins: n(r.working_mins),
    overtimeMins: n(r.overtime_mins),

    baseSalary: n(r.base_salary_month),
    overtimePay: n(r.overtime_pay),
    performanceBonus: n(r.performance_bonus),
    perfectBonus: n(r.perfect_bonus),
    adjustTaxable,
    adjustNonTaxable,
    adjustDeduct,
    grossPay,
    nonTaxable,
    taxableBase,

    nationalPension: n(r.national_pension),
    healthInsurance: n(r.health_insurance),
    longTermCare: n(r.long_term_care),
    employmentInsurance: n(r.employment_insurance),
    incomeTax: n(r.income_tax),
    localTax: n(r.local_tax),
    otherDeduction: n(r.other_deduction),
    totalDeduction: n(r.total_deduction),

    netPay: n(r.net_pay),
  };
}

const SELECT_COLS = sql`
  s.id, s.member_uid, s.status, s.pay_year, s.pay_month, s.paid_at,
  s.working_days, s.working_mins, s.overtime_mins,
  s.base_salary_month, s.overtime_pay, s.performance_bonus, s.perfect_bonus,
  s.adjustments, s.gross_pay,
  s.national_pension, s.health_insurance, s.long_term_care, s.employment_insurance,
  s.income_tax, s.local_tax, s.other_deduction, s.total_deduction, s.net_pay,
  m.name AS m_name, m.position AS m_position, m.milestone_role AS m_milestone_role,
  m.role AS m_role, m.hire_date AS m_hire_date
`;

/* ══════════════════════════════════════════════════════════════
   1. 임금대장 (근로기준법 제48조) — 귀속월 기준
   ══════════════════════════════════════════════════════════════ */
export async function payrollLedger(year: number, month: number): Promise<{
  slips: StatutorySlip[];
  totals: LedgerTotals;
}> {
  const r: any = await db.execute(sql`
    SELECT ${SELECT_COLS}
      FROM payroll_slips s
      LEFT JOIN members m ON m.id = NULLIF(s.member_uid, '')::int
     WHERE s.pay_year = ${year} AND s.pay_month = ${month}
       AND s.status = ANY(ARRAY['APPROVED','SENT','PAID'])
     ORDER BY m.name
  `);
  const slips = rows(r).map(toStatutorySlip);
  return { slips, totals: sumLedger(slips) };
}

export interface LedgerTotals {
  count: number;
  baseSalary: number; overtimePay: number; performanceBonus: number; perfectBonus: number;
  adjustTaxable: number; adjustNonTaxable: number; adjustDeduct: number;
  grossPay: number; nonTaxable: number; taxableBase: number;
  nationalPension: number; healthInsurance: number; longTermCare: number; employmentInsurance: number;
  incomeTax: number; localTax: number; otherDeduction: number; totalDeduction: number;
  netPay: number;
}
export function sumLedger(slips: StatutorySlip[]): LedgerTotals {
  const t: any = { count: slips.length };
  const keys = [
    "baseSalary", "overtimePay", "performanceBonus", "perfectBonus",
    "adjustTaxable", "adjustNonTaxable", "adjustDeduct",
    "grossPay", "nonTaxable", "taxableBase",
    "nationalPension", "healthInsurance", "longTermCare", "employmentInsurance",
    "incomeTax", "localTax", "otherDeduction", "totalDeduction", "netPay",
  ];
  for (const k of keys) t[k] = slips.reduce((s, x) => s + n((x as any)[k]), 0);
  return t as LedgerTotals;
}

/* ══════════════════════════════════════════════════════════════
   2. 원천징수이행상황신고 — **지급일** 기준
      지급한 달의 다음 달 10일까지 세무서 신고·납부.
      지방소득세(특별징수)는 소득세의 10%로, 위택스에 따로 낸다.
   ══════════════════════════════════════════════════════════════ */
export interface WithholdingReport {
  payYear: number;          // 지급 연도
  payMonth: number;         // 지급 월
  dueDate: string;          // 신고·납부 기한 (다음 달 10일)
  /* 근로소득 간이세액 (신고서 코드 A01) */
  headcount: number;        // 인원
  totalPaid: number;        // 총지급액 (비과세 제외)
  incomeTax: number;        // 소득세 (징수·납부할 세액)
  localTax: number;         // 지방소득세 (위택스 별도 신고)
  detail: Array<{
    name: string; paidAt: string | null;
    belongsTo: string;      // 어느 달 근로분인지 (귀속월)
    totalPaid: number; incomeTax: number; localTax: number;
  }>;
  note: string;
}

export async function withholdingReport(payYear: number, payMonth: number): Promise<WithholdingReport> {
  /* 그 달에 '실제로 돈이 나간' 명세서만 (지급 확정 = PAID) */
  const r: any = await db.execute(sql`
    SELECT ${SELECT_COLS}
      FROM payroll_slips s
      LEFT JOIN members m ON m.id = NULLIF(s.member_uid, '')::int
     WHERE s.status = 'PAID'
       AND s.paid_at IS NOT NULL
       AND EXTRACT(YEAR  FROM s.paid_at AT TIME ZONE 'Asia/Seoul') = ${payYear}
       AND EXTRACT(MONTH FROM s.paid_at AT TIME ZONE 'Asia/Seoul') = ${payMonth}
     ORDER BY m.name
  `);
  const slips = rows(r).map(toStatutorySlip);

  const due = payMonth === 12
    ? `${payYear + 1}-01-10`
    : `${payYear}-${String(payMonth + 1).padStart(2, "0")}-10`;

  return {
    payYear, payMonth,
    dueDate: due,
    headcount: slips.length,
    totalPaid: slips.reduce((s, x) => s + x.taxableBase, 0),
    incomeTax: slips.reduce((s, x) => s + x.incomeTax, 0),
    localTax: slips.reduce((s, x) => s + x.localTax, 0),
    detail: slips.map((x) => ({
      name: x.name,
      paidAt: x.paidAt,
      belongsTo: `${x.payYear}-${String(x.payMonth).padStart(2, "0")}`,
      totalPaid: x.taxableBase,
      incomeTax: x.incomeTax,
      localTax: x.localTax,
    })),
    note:
      "총지급액은 비과세를 뺀 과세 대상액입니다. " +
      "소득세는 홈택스 원천징수이행상황신고서 '근로소득 간이세액(A01)'에, " +
      "지방소득세는 위택스 특별징수분으로 따로 신고·납부합니다. " +
      "지급 확정([지급] 버튼)한 명세서만 집계됩니다.",
  };
}

/* ══════════════════════════════════════════════════════════════
   3. 연간 급여·공제 집계 — 귀속 연도 기준
      다음해 3월 근로소득 지급명세서·연말정산에 그대로 옮겨 적는 숫자.
   ══════════════════════════════════════════════════════════════ */
export interface AnnualSummaryRow {
  memberUid: number;
  name: string;
  position: string;
  hireDate: string | null;
  months: number;            // 급여를 받은 달 수
  monthList: string;         // "01,02,03…"
  grossPay: number;          // 지급 총액
  nonTaxable: number;        // 비과세
  taxableBase: number;       // 과세 대상 (= 총급여)
  nationalPension: number;
  healthInsurance: number;
  longTermCare: number;
  employmentInsurance: number;
  incomeTax: number;
  localTax: number;
  netPay: number;
}

export async function annualSummary(year: number): Promise<{
  rows: AnnualSummaryRow[];
  totals: Omit<AnnualSummaryRow, "memberUid" | "name" | "position" | "hireDate" | "monthList">;
}> {
  const r: any = await db.execute(sql`
    SELECT ${SELECT_COLS}
      FROM payroll_slips s
      LEFT JOIN members m ON m.id = NULLIF(s.member_uid, '')::int
     WHERE s.pay_year = ${year}
       AND s.status = ANY(ARRAY['APPROVED','SENT','PAID'])
     ORDER BY m.name, s.pay_month
  `);
  const slips = rows(r).map(toStatutorySlip);

  const byMember = new Map<number, AnnualSummaryRow & { _months: Set<number> }>();
  for (const s of slips) {
    let cur = byMember.get(s.memberUid);
    if (!cur) {
      cur = {
        memberUid: s.memberUid, name: s.name, position: s.position, hireDate: s.hireDate,
        months: 0, monthList: "", _months: new Set<number>(),
        grossPay: 0, nonTaxable: 0, taxableBase: 0,
        nationalPension: 0, healthInsurance: 0, longTermCare: 0, employmentInsurance: 0,
        incomeTax: 0, localTax: 0, netPay: 0,
      };
      byMember.set(s.memberUid, cur);
    }
    cur._months.add(s.payMonth);
    cur.grossPay += s.grossPay;
    cur.nonTaxable += s.nonTaxable;
    cur.taxableBase += s.taxableBase;
    cur.nationalPension += s.nationalPension;
    cur.healthInsurance += s.healthInsurance;
    cur.longTermCare += s.longTermCare;
    cur.employmentInsurance += s.employmentInsurance;
    cur.incomeTax += s.incomeTax;
    cur.localTax += s.localTax;
    cur.netPay += s.netPay;
  }

  const out: AnnualSummaryRow[] = [];
  for (const m of byMember.values()) {
    const months = Array.from(m._months).sort((a, b) => a - b);
    const { _months, ...rest } = m;
    out.push({ ...rest, months: months.length, monthList: months.map((x) => String(x).padStart(2, "0")).join(",") });
  }

  const sum = (k: keyof AnnualSummaryRow) => out.reduce((s, x) => s + n(x[k]), 0);
  return {
    rows: out,
    totals: {
      months: sum("months"),
      grossPay: sum("grossPay"), nonTaxable: sum("nonTaxable"), taxableBase: sum("taxableBase"),
      nationalPension: sum("nationalPension"), healthInsurance: sum("healthInsurance"),
      longTermCare: sum("longTermCare"), employmentInsurance: sum("employmentInsurance"),
      incomeTax: sum("incomeTax"), localTax: sum("localTax"), netPay: sum("netPay"),
    },
  };
}

/* ══════════════════════════════════════════════════════════════
   4. 4대보험 보수총액 (연간) — 매년 3월 신고
      건강보험·국민연금 정산에 쓰는 '연간 과세 보수총액'과 근무월수.
   ══════════════════════════════════════════════════════════════ */
export interface InsuranceBaseRow {
  memberUid: number;
  name: string;
  hireDate: string | null;
  months: number;              // 산정 월수
  annualTaxable: number;       // 연간 보수총액 (과세)
  monthlyAverage: number;      // 월평균 보수 (보수월액 산정 참고)
}

export async function insuranceBase(year: number): Promise<{ rows: InsuranceBaseRow[]; total: number }> {
  const a = await annualSummary(year);
  const out = a.rows.map((r) => ({
    memberUid: r.memberUid,
    name: r.name,
    hireDate: r.hireDate,
    months: r.months,
    annualTaxable: r.taxableBase,
    monthlyAverage: r.months > 0 ? Math.round(r.taxableBase / r.months) : 0,
  }));
  return { rows: out, total: out.reduce((s, x) => s + x.annualTaxable, 0) };
}
