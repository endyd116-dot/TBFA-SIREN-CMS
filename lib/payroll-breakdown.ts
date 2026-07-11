// lib/payroll-breakdown.ts
// 급여명세 '계산 근거' 단일 출처 — 직원 화면 모달 · PDF · 서명본이 모두 이걸 쓴다.
//
// 왜 한 곳에 모으나:
//   근로기준법상 임금명세서에는 금액뿐 아니라 '그 금액이 어떻게 나왔는지(계산방법)'를 적어야 한다.
//   화면과 PDF가 각자 계산해 문구를 만들면 둘이 어긋나는 순간 증빙으로서 신뢰를 잃는다.
//   그래서 명세서에 이미 저장된 '계산 스냅샷'만 읽어서 표시용 항목을 만든다 — 여기서 새로 계산하지 않는다.

export interface BreakdownRow {
  label: string;
  /** 계산방법 — 법정 기재사항 (예: "일급 132,576원 × 지급일 13일") */
  method: string;
  amount: number;
  kind: "ADD" | "DEDUCT";
}

export interface PayrollBreakdown {
  attendance: Array<{ label: string; value: string; hint?: string }>;
  earnings: BreakdownRow[];
  grossPay: number;
  deductions: BreakdownRow[];
  totalDeduction: number;
  netPay: number;
  basis: {
    baseSalary: number;          // 연봉
    dailyWage: number;           // 일급
    monthBusinessDays: number;   // 그 달 영업일수 (분모)
    paidDays: number;            // 지급대상일 (출근 + 유급휴가)
    calculatedAt: string | null; // 이 숫자가 산출된 시각
  };
}

const num = (v: any) => Number(v ?? 0) || 0;

/** 0.03545 → "3.545%" */
function pct(rate: any): string {
  const n = Number(rate ?? 0) || 0;
  return `${+(n * 100).toFixed(4)}%`;
}
const won = (n: any) => `${Math.round(num(n)).toLocaleString("ko-KR")}원`;

function hoursText(mins: any): string {
  const n = Math.max(0, Math.round(num(mins)));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

/**
 * 명세서 1건 → 표시용 계산근거.
 * slip.calculationSnapshot 이 있으면 그걸 근거로 삼고, 없으면(아주 옛 데이터) 금액만 보여준다.
 */
export function buildPayrollBreakdown(slip: any): PayrollBreakdown {
  const snap: any = slip?.calculationSnapshot ?? slip?.calculation_snapshot ?? {};
  const derived: any = snap?.derived ?? {};
  const settings: any = snap?.settings ?? {};

  const baseSalary        = num(snap.baseSalary);
  const dailyWage         = num(derived.dailyWage);
  const monthBusinessDays = num(derived.monthBusinessDays);
  const workingDays       = num(slip.workingDays ?? slip.working_days);
  const paidLeaveDays     = num(slip.paidLeaveDays ?? slip.paid_leave_days);
  const unpaidLeaveDays   = num(slip.unpaidLeaveDays ?? slip.unpaid_leave_days);
  const paidDays          = derived.paidDays != null ? num(derived.paidDays) : workingDays + paidLeaveDays;

  /* ── 근태 근거 ── */
  const attendance: Array<{ label: string; value: string; hint?: string }> = [
    { label: "출근 일수",   value: `${workingDays}일` },
    { label: "유급 휴가",   value: `${paidLeaveDays}일`, hint: "지급 대상에 포함" },
    { label: "지급 대상일", value: `${paidDays}일`,      hint: "출근일 + 유급휴가일" },
  ];
  if (monthBusinessDays > 0) {
    const notPaid = Math.max(0, monthBusinessDays - paidDays);
    attendance.push({ label: "그 달 영업일수", value: `${monthBusinessDays}일`, hint: "일급을 구하는 분모 (주말 제외)" });
    attendance.push({ label: "미산입(무급)",   value: `${notPaid}일`,           hint: "공휴일·결근·무급휴가" });
  }
  attendance.push({ label: "무급 휴가", value: `${unpaidLeaveDays}일` });
  attendance.push({ label: "지각",      value: `${num(slip.lateCount ?? slip.late_count)}회` });
  attendance.push({ label: "결근",      value: `${num(slip.absentCount ?? slip.absent_count)}회` });
  attendance.push({ label: "총 근무시간", value: hoursText(slip.workingMins ?? slip.working_mins) });
  attendance.push({ label: "만근 여부", value: (slip.perfectAttendance ?? slip.perfect_attendance) ? "예" : "아니오" });

  /* ── 지급 항목 + 계산방법 ── */
  const earnings: BreakdownRow[] = [];

  const baseMethod = dailyWage > 0 && monthBusinessDays > 0
    ? `일급 ${won(dailyWage)} × 지급 대상일 ${paidDays}일` +
      (baseSalary > 0 ? `  (일급 = 연봉 ${won(baseSalary)} ÷ 12개월 ÷ 영업일 ${monthBusinessDays}일)` : "")
    : "출근일 기준 일급제";
  earnings.push({
    label: "기본급",
    method: baseMethod,
    amount: num(slip.baseSalaryMonth ?? slip.base_salary_month),
    kind: "ADD",
  });

  const perf = num(slip.performanceBonus ?? slip.performance_bonus);
  if (perf !== 0) {
    const qTotal = num(snap?.quarter?.totalBonusPaid);
    earnings.push({
      label: "성과 보너스",
      method: qTotal > 0 ? `분기 성과급 ${won(qTotal)} ÷ 3개월` : "분기 성과급을 3개월로 나눈 금액",
      amount: perf,
      kind: "ADD",
    });
  }

  const otPay = num(slip.overtimePay ?? slip.overtime_pay);
  if (otPay !== 0) {
    earnings.push({
      label: "야근 수당",
      method: `야근 ${hoursText(slip.overtimeMins ?? slip.overtime_mins)} 기준`,
      amount: otPay, kind: "ADD",
    });
  }

  const perfect = num(slip.perfectBonus ?? slip.perfect_bonus);
  if (perfect !== 0) {
    earnings.push({ label: "만근 보너스", method: "지각·결근·무급휴가 없음", amount: perfect, kind: "ADD" });
  }

  const unpaidCut = num(slip.deductionUnpaid ?? slip.deduction_unpaid);
  if (unpaidCut !== 0) {
    earnings.push({ label: "무급 차감", method: "무급일수 차감", amount: unpaidCut, kind: "DEDUCT" });
  }

  /* 관리자가 손으로 더하거나 뺀 조정 라인 — 사유를 그대로 계산근거로 보여준다 */
  const adjRaw = slip.adjustments;
  const adjList: any[] = Array.isArray(adjRaw) ? adjRaw : [];
  for (const a of adjList) {
    earnings.push({
      label: `조정: ${String(a?.label ?? "").slice(0, 40) || "기타"}`,
      method: String(a?.reason ?? "").slice(0, 80) || "관리자 조정",
      amount: num(a?.amount),
      kind: a?.kind === "DEDUCT" ? "DEDUCT" : "ADD",
    });
  }

  /* ── 공제 항목 + 계산방법 ── */
  const grossPay = num(slip.grossPay ?? slip.gross_pay);
  const health   = num(slip.healthInsurance ?? slip.health_insurance);
  const incomeTx = num(slip.incomeTax ?? slip.income_tax);

  const deductions: BreakdownRow[] = [
    {
      label: "국민연금", kind: "DEDUCT",
      method: settings.pensionRate != null ? `세전 총액 × ${pct(settings.pensionRate)}` : "세전 총액 기준 요율",
      amount: num(slip.nationalPension ?? slip.national_pension),
    },
    {
      label: "건강보험", kind: "DEDUCT",
      method: settings.healthRate != null ? `세전 총액 × ${pct(settings.healthRate)}` : "세전 총액 기준 요율",
      amount: health,
    },
    {
      label: "장기요양보험", kind: "DEDUCT",
      method: settings.longtermRate != null ? `건강보험료 ${won(health)} × ${pct(settings.longtermRate)}` : "건강보험료 기준 요율",
      amount: num(slip.longTermCare ?? slip.long_term_care),
    },
    {
      label: "고용보험", kind: "DEDUCT",
      method: settings.employmentRate != null ? `세전 총액 × ${pct(settings.employmentRate)}` : "세전 총액 기준 요율",
      amount: num(slip.employmentInsurance ?? slip.employment_insurance),
    },
    {
      label: "소득세", kind: "DEDUCT",
      method: settings.incomeTaxRate != null ? `세전 총액 × ${pct(settings.incomeTaxRate)}` : "간이세액표 기준",
      amount: incomeTx,
    },
    {
      label: "지방소득세", kind: "DEDUCT",
      method: `소득세 ${won(incomeTx)} × 10%`,
      amount: num(slip.localTax ?? slip.local_tax),
    },
  ];

  const other = num(slip.otherDeduction ?? slip.other_deduction);
  if (other !== 0) {
    deductions.push({ label: "기타 공제", method: "관리자 지정 공제", amount: other, kind: "DEDUCT" });
  }

  return {
    attendance,
    earnings,
    grossPay,
    deductions,
    totalDeduction: num(slip.totalDeduction ?? slip.total_deduction),
    netPay: num(slip.netPay ?? slip.net_pay),
    basis: {
      baseSalary,
      dailyWage,
      monthBusinessDays,
      paidDays,
      calculatedAt: snap?.calculatedAt ?? null,
    },
  };
}
