// lib/ledger-public.ts — 공익법인 대응 자료 (2026-11-06)
//
// 공시 서식(별지 제31호·제31호의2)에 옮겨 적을 값, 기부금품 수입·지출 명세(부표 1),
// 사업수행 비율, 전용계좌 점검, 재정 공개 자료를 장부에서 만든다.
// 법령 기준 금액·비율은 세무 확인 대상이라 판단 근거와 함께 보여 주고 설정으로 바꿀 수 있게 둔다.
import { sql } from "drizzle-orm";
import { db } from "../db";
import { type FiscalYear, loadFiscalYears } from "./ledger-report";
import { yearStatements, type Amounts, type StatementRow } from "./ledger-statements";
import { loadSettings } from "./approval-docs";

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];

/* 공시 간편서식 대상 기준(별지 제31호의2 작성방법) */
const SIMPLE_ASSET_LIMIT = 500_000_000;
const SIMPLE_INCOME_LIMIT = 300_000_000;

const zero = (): Amounts => ({ total: 0, public: 0, other: 0 });
const pick = (rows: StatementRow[], key: string): Amounts => rows.find((r) => r.key === key)?.current ?? zero();
const sumKeys = (rows: StatementRow[], test: (r: StatementRow) => boolean): Amounts => {
  const out = zero();
  for (const r of rows) {
    if (!test(r)) continue;
    out.total += r.current.total;
    out.public += r.current.public;
    out.other += r.current.other;
  }
  return out;
};

/** 부표 1: 월별 기부금 수입과 지출. 지출은 기부금 재원으로 쓴 비용이다. */
async function donationLedger(fy: FiscalYear) {
  const funds = rowsOf(await db.execute(sql`SELECT id FROM ledger_funds WHERE code IN ('F02', 'F03')`)).map((r: any) => Number(r.id));
  const fundList = funds.length ? sql`(${sql.join(funds.map((f) => sql`${f}`), sql`, `)})` : sql`(0)`;
  const income = rowsOf(await db.execute(sql`
    SELECT EXTRACT(MONTH FROM v.voucher_date)::int AS month, COALESCE(SUM(l.credit - l.debit), 0)::bigint AS amount
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
     WHERE v.status = 'approved' AND v.is_template = FALSE
       AND v.voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}
       AND a.statement_line LIKE 'donation_%'
     GROUP BY 1`));
  const spent = rowsOf(await db.execute(sql`
    SELECT EXTRACT(MONTH FROM v.voucher_date)::int AS month, COALESCE(SUM(l.debit - l.credit), 0)::bigint AS amount
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
     WHERE v.status = 'approved' AND v.is_template = FALSE
       AND v.voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}
       AND a.kind = 'expense' AND l.fund_id IN ${fundList}
     GROUP BY 1`));
  const opening = rowsOf(await db.execute(sql`
    SELECT COALESCE(SUM(CASE WHEN a.statement_line LIKE 'donation_%' THEN l.credit - l.debit
                             WHEN a.kind = 'expense' AND l.fund_id IN ${fundList} THEN l.credit - l.debit ELSE 0 END), 0)::bigint AS balance
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
     WHERE v.status = 'approved' AND v.is_template = FALSE AND v.voucher_date < ${fy.startDate}`))[0];
  const inMap = new Map(income.map((r: any) => [Number(r.month), Number(r.amount) || 0]));
  const outMap = new Map(spent.map((r: any) => [Number(r.month), Number(r.amount) || 0]));
  const carryIn = Number(opening?.balance) || 0;
  let balance = carryIn;
  const months: { month: number; income: number; spent: number; balance: number }[] = [];
  const startMonth = Number(fy.startDate.slice(5, 7));
  const endMonth = Number(fy.endDate.slice(5, 7));
  for (let month = startMonth; month <= endMonth; month += 1) {
    const inAmount = inMap.get(month) ?? 0;
    const outAmount = outMap.get(month) ?? 0;
    balance += inAmount - outAmount;
    months.push({ month, income: inAmount, spent: outAmount, balance });
  }
  return {
    carryIn, months, carryOut: balance,
    totalIncome: months.reduce((t, m) => t + m.income, 0),
    totalSpent: months.reduce((t, m) => t + m.spent, 0),
  };
}

/** 전용계좌가 아닌 현금성 계정으로 오간 거래(상증법 전용계좌 사용 점검) */
async function dedicatedCheck(fy: FiscalYear) {
  const rows = rowsOf(await db.execute(sql`
    SELECT v.id, v.voucher_number, v.voucher_date, v.description, a.name AS account_name, l.debit, l.credit
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
     WHERE v.status = 'approved' AND v.is_template = FALSE AND v.voucher_type <> 'opening'
       AND v.voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}
       AND a.parent_code = '101' AND COALESCE(a.system_role, '') <> 'cash_default'
     ORDER BY v.voucher_date, v.id LIMIT 200`));
  return rows.map((r: any) => ({
    voucherId: Number(r.id), voucherNumber: r.voucher_number, date: String(r.voucher_date).slice(0, 10),
    description: r.description, accountName: r.account_name, debit: Number(r.debit) || 0, credit: Number(r.credit) || 0,
  }));
}

export async function publicBenefitData(year: number) {
  const statements = await yearStatements(year);
  if (!statements) return null;
  const { fy, balance, operating } = statements;
  const b = balance.rows;
  const o = operating.rows;

  /* 간편서식 2번: 금융자산은 현금성 자산과 예치금, 나머지는 기타자산 */
  const FINANCIAL = new Set(["asset.101", "asset.1021", "asset.1031"]);
  const isAssetLine = (r: StatementRow) => r.type === "line" && r.key.startsWith("asset.");
  const totalAssets = pick(b, "asset.total");
  const financial = sumKeys(b, (r) => isAssetLine(r) && FINANCIAL.has(r.key));
  const liabilities = pick(b, "liability.total");
  const assets = {
    total: totalAssets, financial,
    other: { total: totalAssets.total - financial.total, public: totalAssets.public - financial.public, other: totalAssets.other - financial.other },
    liabilities,
  };

  const businessRevenue = pick(o, "revenue");
  const donation = pick(o, "revenue.donation");
  const grant = pick(o, "revenue.grant");
  const fee = pick(o, "revenue.fee");
  const otherRevenue = pick(o, "revenue.other");
  const nonOpRevenue = pick(o, "nonop.revenue");
  const revenue = {
    total: { total: businessRevenue.total + nonOpRevenue.total, public: businessRevenue.public + nonOpRevenue.public, other: businessRevenue.other + nonOpRevenue.other },
    business: businessRevenue, donation, grant, fee, other: otherRevenue, nonOperating: nonOpRevenue,
  };

  const businessExpense = pick(o, "expense");
  const service = pick(o, "expense.service");
  const admin = pick(o, "expense.admin");
  const fundraising = pick(o, "expense.fundraising");
  const nonOpExpense = pick(o, "nonop.expense");
  const tax = pick(o, "tax");
  const expense = {
    total: { total: businessExpense.total + nonOpExpense.total + tax.total, public: businessExpense.public + nonOpExpense.public + tax.public, other: businessExpense.other + nonOpExpense.other + tax.other },
    business: businessExpense, service, admin, fundraising, nonOperating: nonOpExpense, tax,
  };

  /* 출연받은 재산: 기본순자산 직접 증가 */
  const basicIn = Number(rowsOf(await db.execute(sql`
    SELECT COALESCE(SUM(l.credit - l.debit), 0)::bigint AS n
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
     WHERE v.status = 'approved' AND v.is_template = FALSE AND v.voucher_type <> 'opening'
       AND a.statement_line = 'basic_net_asset'
       AND v.voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}`))[0]?.n ?? 0);
  const incomeBase = revenue.total.total + basicIn;
  const simple = totalAssets.total < SIMPLE_ASSET_LIMIT && incomeBase < SIMPLE_INCOME_LIMIT;

  const settings = await loadSettings();
  const pct = (a: number, b_: number) => (b_ > 0 ? Math.round((a / b_) * 1000) / 10 : null);
  const ratios = {
    target: settings.publicRatioTarget,
    serviceOfExpense: pct(service.total, businessExpense.total),
    serviceOfRevenue: pct(service.total, businessRevenue.total),
    adminOfExpense: pct(admin.total, businessExpense.total),
    fundraisingOfExpense: pct(fundraising.total, businessExpense.total),
  };

  const programRows = rowsOf(await db.execute(sql`
    SELECT p.id, p.code, p.name, p.disclosure_code, p.charter_ref, r.result_body, COALESCE(SUM(l.debit - l.credit), 0)::bigint AS amount
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
      JOIN ledger_programs p ON p.id = l.program_id
      LEFT JOIN ledger_program_reports r ON r.program_id = p.id AND r.year = ${year}
     WHERE v.status = 'approved' AND v.is_template = FALSE AND l.function_code = 'service'
       AND a.kind = 'expense' AND v.voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}
     GROUP BY p.id, p.code, p.name, p.disclosure_code, p.charter_ref, r.result_body
     ORDER BY amount DESC`)).map((r: any) => ({
    code: r.code, name: r.name, disclosureCode: r.disclosure_code, charterRef: r.charter_ref,
    resultBody: r.result_body ?? "", amount: Number(r.amount) || 0,
  }));

  const disclosure = rowsOf(await db.execute(sql`
    SELECT year, title, intro, status, data, published_at, published_by_name FROM ledger_disclosures WHERE year = ${year}`))[0];

  return {
    year, period: { from: fy.startDate, to: fy.endDate },
    form: {
      type: simple ? "simple" : "standard",
      label: simple ? "간편서식(별지 제31호의2)" : "표준서식(별지 제31호)",
      totalAssets: totalAssets.total, incomeBase,
    },
    assets, revenue, expense, ratios, programs: programRows,
    donations: await donationLedger(fy),
    dedicated: await dedicatedCheck(fy),
    disclosure: disclosure ? {
      title: disclosure.title, intro: disclosure.intro, status: disclosure.status,
      data: disclosure.data, publishedAt: disclosure.published_at, publishedByName: disclosure.published_by_name,
    } : null,
  };
}

/** 재정 공개 자료. 개인정보는 넣지 않는다. 공개 화면 용어를 따라 지정 전에는 후원회원 회비로 적는다. */
export function disclosureData(p: NonNullable<Awaited<ReturnType<typeof publicBenefitData>>>, designated: boolean) {
  return {
    year: p.year,
    period: p.period,
    income: [
      { label: designated ? "기부금" : "후원회원 회비", amount: p.revenue.donation.total },
      { label: "회원 회비", amount: p.revenue.fee.total },
      { label: "보조금", amount: p.revenue.grant.total },
      { label: "기타 사업수익", amount: p.revenue.other.total },
      { label: "사업외수익", amount: p.revenue.nonOperating.total },
    ].filter((r) => r.amount !== 0),
    incomeTotal: p.revenue.total.total,
    spending: [
      ...p.programs.map((x) => ({ label: x.name, amount: x.amount, kind: "사업수행" })),
      { label: "일반관리", amount: p.expense.admin.total, kind: "일반관리" },
      { label: "모금", amount: p.expense.fundraising.total, kind: "모금" },
      { label: "사업외비용", amount: p.expense.nonOperating.total + p.expense.tax.total, kind: "기타" },
    ].filter((r) => r.amount !== 0),
    spendingTotal: p.expense.total.total,
    serviceRate: p.ratios.serviceOfExpense,
    balance: p.assets.financial.total,
  };
}

/** 세무사 전달용 분개 목록 */
export async function voucherExport(year: number) {
  const fy = (await loadFiscalYears()).find((f) => f.year === year);
  if (!fy) return null;
  const rows = rowsOf(await db.execute(sql`
    SELECT v.voucher_number, v.voucher_date, v.voucher_type, v.description, v.payee_name, v.evidence_type, v.source_type,
           l.line_no, l.account_code, a.name AS account_name, l.debit, l.credit, l.function_code, p.name AS program_name, f.name AS fund_name
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
      LEFT JOIN ledger_programs p ON p.id = l.program_id
      LEFT JOIN ledger_funds f ON f.id = l.fund_id
     WHERE v.status = 'approved' AND v.is_template = FALSE
       AND v.voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}
     ORDER BY v.voucher_date, v.id, l.line_no
     LIMIT 50000`));
  return rows.map((r: any) => ({
    number: r.voucher_number, date: String(r.voucher_date).slice(0, 10), type: r.voucher_type, description: r.description,
    payee: r.payee_name, evidence: r.evidence_type, source: r.source_type, accountCode: r.account_code, accountName: r.account_name,
    debit: Number(r.debit) || 0, credit: Number(r.credit) || 0, functionCode: r.function_code, program: r.program_name, fund: r.fund_name,
  }));
}

