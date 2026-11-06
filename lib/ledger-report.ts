// lib/ledger-report.ts — 총계정원장·시산표 계산 (2026-11-06)
//
// 승인된 전표의 분개 줄만 읽는다. 연말 이월 전표를 만들지 않는다.
// 자산·부채·순자산은 처음부터 누계, 수익·비용은 해당 회계연도만 더한다.
// 지난 해까지의 수익·비용 차액은 시산표에 «전기 운영성과» 계산 행으로 보여 합계를 맞춘다.
import { sql } from "drizzle-orm";
import { db } from "../db";
import { ymd } from "./ledger-post";

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const BALANCE_KINDS = ["asset", "liability", "net_asset"];

export interface FiscalYear {
  year: number;
  startDate: string;
  endDate: string;
  closedThrough: string | null;
  status: string;
}

export async function loadFiscalYears(): Promise<FiscalYear[]> {
  const res = await db.execute(sql`
    SELECT year, start_date, end_date, closed_through, status FROM ledger_fiscal_years ORDER BY year`);
  return rowsOf(res).map((r: any) => ({
    year: Number(r.year),
    startDate: ymd(r.start_date),
    endDate: ymd(r.end_date),
    closedThrough: r.closed_through ? ymd(r.closed_through) : null,
    status: r.status,
  }));
}

export function monthEnd(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

export interface TrialRow {
  code: string;
  name: string;
  kind: string;
  normalSide: string;
  debitTotal: number;
  creditTotal: number;
  debitBalance: number;
  creditBalance: number;
}

export async function trialBalance(year: number, month: number | null) {
  const fiscalYears = await loadFiscalYears();
  const fy = fiscalYears.find((f) => f.year === year);
  if (!fy) return null;

  const requestedEnd = month ? monthEnd(year, month) : fy.endDate;
  const to = requestedEnd > fy.endDate ? fy.endDate : requestedEnd;

  const res = await db.execute(sql`
    SELECT a.code, a.name, a.kind, a.normal_side,
           COALESCE(SUM(l.debit), 0)::bigint AS debit_total,
           COALESCE(SUM(l.credit), 0)::bigint AS credit_total
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
     WHERE v.status = 'approved' AND v.is_template = FALSE
       AND v.voucher_date <= ${to}
       AND (a.kind IN ('asset','liability','net_asset') OR v.voucher_date >= ${fy.startDate})
     GROUP BY a.code, a.name, a.kind, a.normal_side
     ORDER BY a.code`);

  const rows: TrialRow[] = rowsOf(res).map((r: any) => {
    const debitTotal = Number(r.debit_total) || 0;
    const creditTotal = Number(r.credit_total) || 0;
    const net = debitTotal - creditTotal;
    return {
      code: r.code,
      name: r.name,
      kind: r.kind,
      normalSide: r.normal_side,
      debitTotal,
      creditTotal,
      debitBalance: net > 0 ? net : 0,
      creditBalance: net < 0 ? -net : 0,
    };
  });

  const carry = rowsOf(await db.execute(sql`
    SELECT COALESCE(SUM(l.credit - l.debit), 0)::bigint AS net
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
     WHERE v.status = 'approved' AND v.is_template = FALSE
       AND a.kind IN ('revenue','expense')
       AND v.voucher_date < ${fy.startDate}`))[0];
  const carryForward = Number(carry?.net) || 0;

  const totals = rows.reduce(
    (t, r) => ({
      debitTotal: t.debitTotal + r.debitTotal,
      creditTotal: t.creditTotal + r.creditTotal,
      debitBalance: t.debitBalance + r.debitBalance,
      creditBalance: t.creditBalance + r.creditBalance,
    }),
    { debitTotal: 0, creditTotal: 0, debitBalance: 0, creditBalance: 0 },
  );
  if (carryForward > 0) { totals.creditTotal += carryForward; totals.creditBalance += carryForward; }
  if (carryForward < 0) { totals.debitTotal += -carryForward; totals.debitBalance += -carryForward; }

  return {
    period: { from: fy.startDate, to, closedThrough: fy.closedThrough },
    rows,
    carryForward,
    totals,
    balanced: totals.debitTotal === totals.creditTotal && totals.debitBalance === totals.creditBalance,
  };
}

export interface GeneralLedgerQuery {
  accountCode: string;
  from: string;
  to: string;
  programId: number | null;
  fundId: number | null;
  limit: number;
  offset: number;
}

export async function generalLedger(q: GeneralLedgerQuery) {
  const accountRow = rowsOf(await db.execute(sql`
    SELECT code, name, kind, normal_side FROM account_codes WHERE code = ${q.accountCode} LIMIT 1`))[0];
  if (!accountRow) return null;

  const debitNormal = accountRow.normal_side === "debit";
  const isBalanceAccount = BALANCE_KINDS.includes(accountRow.kind);

  /* 수익·비용의 기초 잔액은 해당 회계연도 시작일부터만 더한다 */
  const fy = (await loadFiscalYears()).find((f) => q.from >= f.startDate && q.from <= f.endDate);
  const openingFrom = isBalanceAccount ? "0001-01-01" : fy?.startDate ?? q.from;

  const openingRow = rowsOf(await db.execute(sql`
    SELECT COALESCE(SUM(l.debit), 0)::bigint AS dr, COALESCE(SUM(l.credit), 0)::bigint AS cr
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
     WHERE l.account_code = ${q.accountCode}
       AND v.status = 'approved' AND v.is_template = FALSE
       AND v.voucher_date >= ${openingFrom} AND v.voucher_date < ${q.from}
       AND (${q.programId}::int IS NULL OR l.program_id = ${q.programId})
       AND (${q.fundId}::int IS NULL OR l.fund_id = ${q.fundId})`))[0];
  const openingDr = Number(openingRow?.dr) || 0;
  const openingCr = Number(openingRow?.cr) || 0;
  const opening = debitNormal ? openingDr - openingCr : openingCr - openingDr;

  const totalRow = rowsOf(await db.execute(sql`
    SELECT COUNT(*)::int AS n,
           COALESCE(SUM(l.debit), 0)::bigint AS dr, COALESCE(SUM(l.credit), 0)::bigint AS cr
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
     WHERE l.account_code = ${q.accountCode}
       AND v.status = 'approved' AND v.is_template = FALSE
       AND v.voucher_date BETWEEN ${q.from} AND ${q.to}
       AND (${q.programId}::int IS NULL OR l.program_id = ${q.programId})
       AND (${q.fundId}::int IS NULL OR l.fund_id = ${q.fundId})`))[0];
  const total = Number(totalRow?.n) || 0;
  const periodDebit = Number(totalRow?.dr) || 0;
  const periodCredit = Number(totalRow?.cr) || 0;

  /* 페이지 앞쪽 거래를 더해 시작 잔액을 맞춘다 */
  const beforePage = rowsOf(await db.execute(sql`
    SELECT COALESCE(SUM(s.debit), 0)::bigint AS dr, COALESCE(SUM(s.credit), 0)::bigint AS cr
      FROM (
        SELECT l.debit, l.credit
          FROM voucher_lines l
          JOIN vouchers v ON v.id = l.voucher_id
         WHERE l.account_code = ${q.accountCode}
           AND v.status = 'approved' AND v.is_template = FALSE
           AND v.voucher_date BETWEEN ${q.from} AND ${q.to}
           AND (${q.programId}::int IS NULL OR l.program_id = ${q.programId})
           AND (${q.fundId}::int IS NULL OR l.fund_id = ${q.fundId})
         ORDER BY v.voucher_date, v.id, l.line_no
         LIMIT ${q.offset}
      ) s`))[0];
  let balance = opening
    + (debitNormal
      ? (Number(beforePage?.dr) || 0) - (Number(beforePage?.cr) || 0)
      : (Number(beforePage?.cr) || 0) - (Number(beforePage?.dr) || 0));

  const res = await db.execute(sql`
    SELECT v.id AS voucher_id, v.voucher_number, v.voucher_date, v.description, v.payee_name,
           v.voucher_type, v.reversed_by_id, v.reversal_of_id,
           l.debit, l.credit, l.function_code, l.memo, l.program_id, l.fund_id
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
     WHERE l.account_code = ${q.accountCode}
       AND v.status = 'approved' AND v.is_template = FALSE
       AND v.voucher_date BETWEEN ${q.from} AND ${q.to}
       AND (${q.programId}::int IS NULL OR l.program_id = ${q.programId})
       AND (${q.fundId}::int IS NULL OR l.fund_id = ${q.fundId})
     ORDER BY v.voucher_date, v.id, l.line_no
     LIMIT ${q.limit} OFFSET ${q.offset}`);

  const programNames = new Map<number, string>();
  const fundNames = new Map<number, string>();
  try {
    for (const r of rowsOf(await db.execute(sql`SELECT id, name FROM ledger_programs`))) programNames.set(Number(r.id), r.name);
    for (const r of rowsOf(await db.execute(sql`SELECT id, name FROM ledger_funds`))) fundNames.set(Number(r.id), r.name);
  } catch (err: any) {
    console.warn("[ledger-report] 사업·재원 이름 조회 실패 (빈 값으로 계속):", err?.message);
  }

  const rows = rowsOf(res).map((r: any) => {
    const debit = Number(r.debit) || 0;
    const credit = Number(r.credit) || 0;
    balance += debitNormal ? debit - credit : credit - debit;
    return {
      date: ymd(r.voucher_date),
      voucherId: Number(r.voucher_id),
      voucherNumber: r.voucher_number,
      description: r.description,
      payeeName: r.payee_name,
      debit,
      credit,
      balance,
      functionCode: r.function_code,
      programName: r.program_id == null ? null : programNames.get(Number(r.program_id)) ?? null,
      fundName: r.fund_id == null ? null : fundNames.get(Number(r.fund_id)) ?? null,
      memo: r.memo,
      voucherType: r.voucher_type,
      reversed: r.reversed_by_id != null,
    };
  });

  return {
    account: { code: accountRow.code, name: accountRow.name, kind: accountRow.kind, normalSide: accountRow.normal_side },
    opening,
    rows,
    periodDebit,
    periodCredit,
    closing: opening + (debitNormal ? periodDebit - periodCredit : periodCredit - periodDebit),
    total,
    limit: q.limit,
    offset: q.offset,
  };
}

/** 월별 마감 점검. 장부 기간 안의 전표만 본다. */
export async function closeStatus(year: number) {
  const fy = (await loadFiscalYears()).find((f) => f.year === year);
  if (!fy) return null;

  const startMonth = Number(fy.startDate.slice(5, 7));
  const endMonth = Number(fy.endDate.slice(5, 7));
  const months: any[] = [];

  const openVoucherRows = rowsOf(await db.execute(sql`
    SELECT to_char(voucher_date, 'YYYY-MM') AS ym, COUNT(*)::int AS n
      FROM vouchers
     WHERE is_template = FALSE AND status IN ('draft','submitted','rejected')
       AND voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}
     GROUP BY 1`));
  const openVouchers = new Map<string, number>(openVoucherRows.map((r: any) => [r.ym, Number(r.n)]));

  let bankPending = new Map<string, number>();
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT to_char(txn_date, 'YYYY-MM') AS ym, COUNT(*)::int AS n
        FROM bank_transactions
       WHERE status = 'pending' AND txn_date BETWEEN ${fy.startDate} AND ${fy.endDate}
       GROUP BY 1`));
    bankPending = new Map(rows.map((r: any) => [r.ym, Number(r.n)]));
  } catch (err: any) {
    console.warn("[ledger-report] 미확인 통장 거래 집계 실패 (0으로 계속):", err?.message);
  }

  for (let month = startMonth; month <= endMonth; month += 1) {
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    const end = monthEnd(year, month);
    months.push({
      month,
      ym,
      from: month === startMonth ? fy.startDate : `${ym}-01`,
      to: end > fy.endDate ? fy.endDate : end,
      closed: fy.closedThrough != null && fy.closedThrough >= (end > fy.endDate ? fy.endDate : end),
      openVouchers: openVouchers.get(ym) ?? 0,
      pendingBankTxn: bankPending.get(ym) ?? 0,
    });
  }

  return { fiscalYear: fy, months };
}

/** 가지급금·가수금처럼 결산 전에 비워야 하는 임시 계정 잔액 */
export async function suspenseBalances(to: string) {
  const rows = rowsOf(await db.execute(sql`
    SELECT a.code, a.name, COALESCE(SUM(l.debit - l.credit), 0)::bigint AS net
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
     WHERE a.statement_line = 'suspense'
       AND v.status = 'approved' AND v.is_template = FALSE AND v.voucher_date <= ${to}
     GROUP BY a.code, a.name
     HAVING COALESCE(SUM(l.debit - l.credit), 0) <> 0`));
  return rows.map((r: any) => ({ code: r.code, name: r.name, amount: Math.abs(Number(r.net) || 0) }));
}

/** 정관 근거가 없는 사업의 사업수행비용 합계와 비중 */
export async function charterGap(year: number) {
  const fy = (await loadFiscalYears()).find((f) => f.year === year);
  if (!fy) return null;
  const rows = rowsOf(await db.execute(sql`
    SELECT p.code, p.name, p.charter_ref, COALESCE(SUM(l.debit - l.credit), 0)::bigint AS amount
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN ledger_programs p ON p.id = l.program_id
     WHERE v.status = 'approved' AND v.is_template = FALSE
       AND l.function_code = 'service'
       AND v.voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}
     GROUP BY p.code, p.name, p.charter_ref
     ORDER BY p.code`));
  const programs = rows.map((r: any) => ({
    code: r.code, name: r.name, charterRef: r.charter_ref, amount: Number(r.amount) || 0,
  }));
  const total = programs.reduce((s, p) => s + p.amount, 0);
  const outside = programs.filter((p) => !p.charterRef).reduce((s, p) => s + p.amount, 0);
  return { total, outside, outsideRate: total > 0 ? Math.round((outside / total) * 1000) / 10 : 0, programs };
}
