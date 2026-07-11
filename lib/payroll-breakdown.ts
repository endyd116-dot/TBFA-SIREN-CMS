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
  /** 비과세 지급 항목 (4대보험·소득세 산정에서 제외) */
  taxFree?: boolean;
}

export interface PayrollBreakdown {
  attendance: Array<{ label: string; value: string; hint?: string; warn?: boolean }>;
  earnings: BreakdownRow[];
  grossPay: number;
  /** 4대보험·소득세를 매기는 기준 금액 = 세전 총액 − 비과세 지급액 */
  taxableBase: number;
  nonTaxableTotal: number;
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

/** 조정 라인 목록 (형식이 어긋나도 안전하게) */
function adjustmentsOf(slip: any): any[] {
  const a = slip?.adjustments;
  return Array.isArray(a) ? a : [];
}

/** 비과세로 지급한 금액 합계 (조정 라인 중 '비과세' 표시된 지급 항목).
 *  taxable을 지정하지 않은 옛 데이터는 '과세'로 본다 — 공제를 덜 떼는 쪽으로 기울지 않게. */
/* 직책 표기 — 급여명세서·직원 화면·목록이 모두 같은 문구를 쓰도록 한 곳에서 만든다.
   운영자가 급여관리에서 직접 입력한 '직책'이 최우선. 비어 있으면 성과관리 역할(SM/PM/SI)을
   한국어로 풀어 쓰고, 그것도 없으면 계정 권한 등급으로 갈음한다. */
const MILESTONE_ROLE_LABEL: Record<string, string> = { SM: "사무국장", PM: "정책국장", SI: "SI관리자" };
const ACCOUNT_ROLE_LABEL: Record<string, string> = { super_admin: "총괄관리자", admin: "관리자", operator: "운영자" };
export function positionLabelOf(member: {
  position?: string | null; milestoneRole?: string | null; role?: string | null;
} | null | undefined): string {
  const pos = String(member?.position ?? "").trim();
  if (pos) return pos;
  const ms = String(member?.milestoneRole ?? "").trim();
  if (ms) return MILESTONE_ROLE_LABEL[ms] || ms;
  const acc = String(member?.role ?? "").trim();
  if (acc) return ACCOUNT_ROLE_LABEL[acc] || acc;
  return "-";
}

export function nonTaxableTotalOf(slip: any): number {
  return adjustmentsOf(slip)
    .filter(a => a?.kind !== "DEDUCT" && a?.taxable === false)
    .reduce((s, a) => s + num(a?.amount), 0);
}

/**
 * 과세 대상액 = 세전 총액 − 비과세 지급액.
 * 4대보험·소득세는 반드시 이 금액을 기준으로 계산해야 명세서에 적는 계산방법과 실제 금액이 일치한다.
 * (예: 차량유지비를 비과세로 30만원 지급했다면 그 30만원엔 보험료를 매기지 않는다)
 */
export function taxableBaseOf(slip: any, grossPay?: number): number {
  const gross = grossPay != null ? num(grossPay) : num(slip?.grossPay ?? slip?.gross_pay);
  return Math.max(0, gross - nonTaxableTotalOf(slip));
}

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

  /* ── 근태 근거 ──
     2026-07-12: 지급일수는 '실제 근무시간'으로 정한다 (8시간↑=1.0 / 6~8h=0.75 / 4~6h=0.5 / 2~4h=0.25).
     그래서 근무일수가 소수(예: 10.75일)로 나올 수 있고, 그 이유가 명세서에 드러나야 한다. */
  const stdHours = num(snap?.att?.dailyHours) || 8;
  const attendance: Array<{ label: string; value: string; hint?: string; warn?: boolean }> = [
    { label: "근무 일수", value: `${workingDays}일`,
      hint: `실제 근무시간 기준 (소정 ${stdHours}시간 = 1일 · 반차 0.5일 · 반반차 0.75일)` },
    { label: "유급 휴가", value: `${paidLeaveDays}일`, hint: "하루를 통째로 쉰 유급휴가 (지급 대상 포함)" },
    { label: "지급 대상일", value: `${paidDays}일`, hint: "근무일수 + 유급휴가일" },
  ];
  if (monthBusinessDays > 0) {
    attendance.push({ label: "그 달 영업일수", value: `${monthBusinessDays}일`, hint: "일급을 구하는 분모 (주말 제외)" });
  }
  attendance.push({ label: "무급 휴가", value: `${unpaidLeaveDays}일` });
  attendance.push({ label: "지각",      value: `${num(slip.lateCount ?? slip.late_count)}회` });
  attendance.push({ label: "결근",      value: `${num(slip.absentCount ?? slip.absent_count)}회` });

  /* 지급에서 빠지거나 줄어든 날은 이유를 반드시 드러낸다 — 직원이 급여가 왜 줄었는지 알아야 한다. */
  const shortDays = num(snap?.att?.shortDays);
  if (shortDays > 0) {
    attendance.push({
      label: "소정근로 미달", value: `${shortDays}일`,
      hint: `${stdHours}시간을 못 채운 날 — 일한 시간만큼 0.25일 단위로 지급 (반차 0.5 · 반반차 0.75)`,
      warn: true,
    });
  }
  const unreportedRemote = num(snap?.att?.unreportedRemoteDays);
  if (unreportedRemote > 0) {
    attendance.push({
      label: "재택보고서 미제출", value: `${unreportedRemote}일`,
      hint: "근무 불인정 — 지급일수에서 제외 (보고서를 제출하면 다시 인정)",
      warn: true,
    });
  }
  const offDay = num(snap?.att?.offDayWorkDays);
  if (offDay > 0) {
    attendance.push({
      label: "휴일 출근", value: `${offDay}일`,
      hint: "토·일·공휴일 출근은 지급일수에서 제외 (휴일근무 보상은 별도 지급)",
      warn: true,
    });
  }
  const noCheckout = num(snap?.att?.noCheckoutDays);
  if (noCheckout > 0) {
    attendance.push({
      label: "퇴근 미기록", value: `${noCheckout}일`,
      hint: "근무시간을 알 수 없어 지급에서 빠졌습니다 — 근태 수정 요청으로 퇴근 시각을 등록하세요",
      warn: true,
    });
  }

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

  /* 관리자가 손으로 더하거나 뺀 조정 라인 (성과금·차량지원 등) — 사유를 그대로 계산근거로 보여준다.
     비과세로 지정한 항목은 4대보험·소득세 산정에서 빠지므로 명세서에 그 사실을 표시한다. */
  for (const a of adjustmentsOf(slip)) {
    const isDeduct = a?.kind === "DEDUCT";
    const taxFree = !isDeduct && a?.taxable === false;
    earnings.push({
      label: String(a?.label ?? "").slice(0, 40) || "기타 조정",
      method: (String(a?.reason ?? "").slice(0, 80) || "관리자 조정")
        + (taxFree ? "  ·  비과세 (보험료·세금 산정 제외)" : ""),
      amount: num(a?.amount),
      kind: isDeduct ? "DEDUCT" : "ADD",
      taxFree,
    });
  }

  /* ── 공제 항목 + 계산방법 ──
     기준은 '세전 총액'이 아니라 '과세 대상액'(= 세전 − 비과세 지급액)이다.
     비과세 항목이 없으면 둘이 같으므로 문구도 '세전 총액'으로 자연스럽게 나온다. */
  const grossPay = num(slip.grossPay ?? slip.gross_pay);
  const nonTaxableTotal = nonTaxableTotalOf(slip);
  const taxableBase = Math.max(0, grossPay - nonTaxableTotal);
  const baseLabel = nonTaxableTotal > 0 ? `과세 대상액 ${won(taxableBase)}` : "세전 총액";

  const health   = num(slip.healthInsurance ?? slip.health_insurance);
  const incomeTx = num(slip.incomeTax ?? slip.income_tax);

  const deductions: BreakdownRow[] = [
    {
      label: "국민연금", kind: "DEDUCT",
      method: settings.pensionRate != null ? `${baseLabel} × ${pct(settings.pensionRate)}` : `${baseLabel} 기준 요율`,
      amount: num(slip.nationalPension ?? slip.national_pension),
    },
    {
      label: "건강보험", kind: "DEDUCT",
      method: settings.healthRate != null ? `${baseLabel} × ${pct(settings.healthRate)}` : `${baseLabel} 기준 요율`,
      amount: health,
    },
    {
      label: "장기요양보험", kind: "DEDUCT",
      method: settings.longtermRate != null ? `건강보험료 ${won(health)} × ${pct(settings.longtermRate)}` : "건강보험료 기준 요율",
      amount: num(slip.longTermCare ?? slip.long_term_care),
    },
    {
      label: "고용보험", kind: "DEDUCT",
      method: settings.employmentRate != null ? `${baseLabel} × ${pct(settings.employmentRate)}` : `${baseLabel} 기준 요율`,
      amount: num(slip.employmentInsurance ?? slip.employment_insurance),
    },
    {
      label: "소득세", kind: "DEDUCT",
      method: settings.incomeTaxRate != null && num(settings.incomeTaxRate) > 0
        ? `${baseLabel} × ${pct(settings.incomeTaxRate)}`
        : `근로소득 간이세액표 — ${baseLabel} · 공제대상가족 ${num(snap?.tax?.dependents) || 1}명` +
          (num(snap?.tax?.children) > 0 ? ` · 8~20세 자녀 ${num(snap.tax.children)}명 공제` : ""),
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
    taxableBase,
    nonTaxableTotal,
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
