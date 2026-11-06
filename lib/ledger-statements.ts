// lib/ledger-statements.ts — 재무제표와 결산 서류 계산 (2026-11-06)
//
// 설계: docs/active/2026-11-06-ledger-settlement-design.md
// 공식 재무제표의 단일 출처다. 승인된 전표의 분개 줄만 읽고, 화면·인쇄·엑셀·PDF가 같은 행을 쓴다.
// 부문은 전표 단위로 판단한다. 줄 단위로 나누면 현금 줄이 늘 공익목적사업에 남아 부문별 대차가 맞지 않는다.
import { sql } from "drizzle-orm";
import { db } from "../db";
import { loadAccountToMok } from "./finance-budget-report";
import { type FiscalYear, loadFiscalYears } from "./ledger-report";

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];

export interface Amounts { total: number; public: number; other: number }
export interface StatementRow {
  key: string;
  label: string;
  /** 0 큰 제목, 1 구분, 2 항목, 3 세부 */
  level: number;
  type: "head" | "line" | "subtotal" | "total";
  current: Amounts;
  previous: Amounts | null;
  accountCode?: string;
  warning?: string;
}

const zero = (): Amounts => ({ total: 0, public: 0, other: 0 });
const add = (a: Amounts, b: Amounts): Amounts => ({ total: a.total + b.total, public: a.public + b.public, other: a.other + b.other });
const minus = (a: Amounts, b: Amounts): Amounts => ({ total: a.total - b.total, public: a.public - b.public, other: a.other - b.other });
const isZero = (a: Amounts | null) => !a || (a.total === 0 && a.public === 0 && a.other === 0);
const bump = (target: Amounts, amount: number, isOther: boolean) => {
  target.total += amount;
  if (isOther) target.other += amount; else target.public += amount;
};

/** 전표 단위 부문. 줄 하나라도 기타사업이면 전표 전체를 기타사업으로 본다. */
const SEGMENT_CTE = sql`seg AS (
  SELECT voucher_id, bool_or(segment = 'other') AS is_other FROM voucher_lines GROUP BY voucher_id
)`;

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

interface BalanceRow {
  code: string; name: string; parentCode: string | null; kind: string; normalSide: string;
  statementLine: string; sortOrder: number; isOther: boolean; net: number;
}

/** 기준일까지 계정별 누계. net은 차변 − 대변이다. */
async function balancesAsOf(asOf: string): Promise<BalanceRow[]> {
  const rows = rowsOf(await db.execute(sql`
    WITH ${SEGMENT_CTE}
    SELECT a.code, a.name, a.parent_code, a.kind, a.normal_side, a.statement_line, a.sort_order, seg.is_other,
           COALESCE(SUM(l.debit - l.credit), 0)::bigint AS net
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
      JOIN seg ON seg.voucher_id = l.voucher_id
     WHERE v.status = 'approved' AND v.is_template = FALSE AND v.voucher_date <= ${asOf}
     GROUP BY a.code, a.name, a.parent_code, a.kind, a.normal_side, a.statement_line, a.sort_order, seg.is_other
     ORDER BY a.sort_order, a.code`));
  return rows.map((r: any) => ({
    code: r.code, name: r.name, parentCode: r.parent_code, kind: r.kind, normalSide: r.normal_side,
    statementLine: r.statement_line, sortOrder: Number(r.sort_order) || 0,
    isOther: r.is_other === true || r.is_other === "t", net: Number(r.net) || 0,
  }));
}

/* 현금및현금성자산은 계정이 여러 개라도 재무상태표에서 한 줄이다 */
const CASH_PARENT = "101";

/** 기준일의 칸별 금액. 자산은 차변 잔액, 부채·순자산은 대변 잔액을 양수로 한다. */
function collectBalance(rows: BalanceRow[]) {
  const lines = new Map<string, { label: string; section: string; order: number; side: "asset" | "credit"; amounts: Amounts; suspense: boolean }>();
  const retained = zero();
  for (const r of rows) {
    if (r.kind === "revenue" || r.kind === "expense") {
      bump(retained, -r.net, r.isOther);
      continue;
    }
    const merged = r.parentCode === CASH_PARENT;
    const key = merged ? CASH_PARENT : r.code;
    const side = r.kind === "asset" ? "asset" : "credit";
    const entry = lines.get(key) ?? {
      label: merged ? "현금및현금성자산" : r.statementLine === "suspense" ? `미정리 ${r.name}` : r.name,
      section: r.statementLine === "suspense" ? (r.kind === "asset" ? "current_asset" : "current_liability") : r.statementLine,
      order: r.sortOrder, side, amounts: zero(), suspense: r.statementLine === "suspense",
    };
    bump(entry.amounts, side === "asset" ? r.net : -r.net, r.isOther);
    lines.set(key, entry);
  }
  return { lines, retained };
}

const ASSET_SECTIONS: { key: string; label: string }[] = [
  { key: "investment_asset", label: "투자자산" },
  { key: "tangible_asset", label: "유형자산" },
  { key: "intangible_asset", label: "무형자산" },
  { key: "other_noncurrent_asset", label: "기타비유동자산" },
];

/** 재무상태표(별지 1호). asOf 하나 또는 당기·전기 두 기준일로 만든다. */
export async function balanceSheet(asOf: string, previousAsOf: string | null = null) {
  const current = collectBalance(await balancesAsOf(asOf));
  const previous = previousAsOf ? collectBalance(await balancesAsOf(previousAsOf)) : null;

  const rows: StatementRow[] = [];
  const emit = (key: string, label: string, level: number, type: StatementRow["type"], cur: Amounts, prev: Amounts | null) =>
    rows.push({ key, label, level, type, current: cur, previous: prev });
  const emptyPrev = () => (previous ? zero() : null);

  /** 한 구분의 계정 줄을 내보내고 소계를 돌려준다 */
  const section = (key: string, keyPrefix: string) => {
    const sum = zero();
    const prevSum = emptyPrev();
    const codes = new Set<string>();
    for (const [code, line] of current.lines) if (line.section === key) codes.add(code);
    if (previous) for (const [code, line] of previous.lines) if (line.section === key) codes.add(code);
    const ordered = [...codes].sort((a, b) =>
      (current.lines.get(a)?.order ?? previous?.lines.get(a)?.order ?? 0) - (current.lines.get(b)?.order ?? previous?.lines.get(b)?.order ?? 0)
      || a.localeCompare(b));
    const out: StatementRow[] = [];
    for (const code of ordered) {
      const cur = current.lines.get(code);
      const prev = previous?.lines.get(code);
      const curAmounts = cur?.amounts ?? zero();
      const prevAmounts = previous ? prev?.amounts ?? zero() : null;
      Object.assign(sum, add(sum, curAmounts));
      if (prevSum && prevAmounts) Object.assign(prevSum, add(prevSum, prevAmounts));
      if (isZero(curAmounts) && isZero(prevAmounts)) continue;
      const suspense = cur?.suspense ?? prev?.suspense ?? false;
      out.push({
        key: `${keyPrefix}.${code}`, label: cur?.label ?? prev?.label ?? code, level: 2, type: "line",
        current: curAmounts, previous: prevAmounts, accountCode: code,
        ...(suspense ? { warning: "결산 전에 정리해야 합니다" } : {}),
      });
    }
    return { out, sum, prevSum };
  };

  /* 자산 */
  const currentAssets = section("current_asset", "asset");
  emit("asset", "자산", 0, "head", zero(), null);
  emit("asset.current", "유동자산", 1, "subtotal", currentAssets.sum, currentAssets.prevSum);
  rows.push(...currentAssets.out);

  let nonCurrent = zero();
  let nonCurrentPrev = emptyPrev();
  const nonCurrentGroups = ASSET_SECTIONS.map((s) => {
    const group = section(s.key, "asset");
    nonCurrent = add(nonCurrent, group.sum);
    if (nonCurrentPrev && group.prevSum) nonCurrentPrev = add(nonCurrentPrev, group.prevSum);
    return { ...s, group };
  });
  emit("asset.noncurrent", "비유동자산", 1, "subtotal", nonCurrent, nonCurrentPrev);
  for (const g of nonCurrentGroups) {
    if (isZero(g.group.sum) && isZero(g.group.prevSum)) continue;
    rows.push({ key: `asset.${g.key}`, label: g.label, level: 2, type: "subtotal", current: g.group.sum, previous: g.group.prevSum });
    rows.push(...g.group.out.map((r) => ({ ...r, level: 3 })));
  }
  const totalAssets = add(currentAssets.sum, nonCurrent);
  const totalAssetsPrev = previous ? add(currentAssets.prevSum!, nonCurrentPrev!) : null;
  emit("asset.total", "자산총계", 0, "total", totalAssets, totalAssetsPrev);

  /* 부채 */
  const currentLiab = section("current_liability", "liability");
  const nonCurrentLiab = section("noncurrent_liability", "liability");
  emit("liability", "부채", 0, "head", zero(), null);
  emit("liability.current", "유동부채", 1, "subtotal", currentLiab.sum, currentLiab.prevSum);
  rows.push(...currentLiab.out);
  emit("liability.noncurrent", "비유동부채", 1, "subtotal", nonCurrentLiab.sum, nonCurrentLiab.prevSum);
  rows.push(...nonCurrentLiab.out);
  const totalLiab = add(currentLiab.sum, nonCurrentLiab.sum);
  const totalLiabPrev = previous ? add(currentLiab.prevSum!, nonCurrentLiab.prevSum!) : null;
  emit("liability.total", "부채총계", 0, "total", totalLiab, totalLiabPrev);

  /* 순자산: 잉여금에 누적 운영성과를 더한다 */
  const basic = section("basic_net_asset", "net");
  const ordinary = section("ordinary_net_asset", "net");
  const adjustment = section("net_asset_adjustment", "net");
  const ordinaryTotal = add(ordinary.sum, current.retained);
  const ordinaryPrev = previous ? add(ordinary.prevSum!, previous.retained) : null;
  emit("net", "순자산", 0, "head", zero(), null);
  emit("net.basic", "기본순자산", 1, "subtotal", basic.sum, basic.prevSum);
  rows.push(...basic.out);
  emit("net.ordinary", "보통순자산", 1, "subtotal", ordinaryTotal, ordinaryPrev);
  const surplus = ordinary.out.find((r) => r.accountCode === "3021");
  rows.push(...ordinary.out.filter((r) => r !== surplus));
  rows.push({
    key: "net.surplus", label: "잉여금", level: 2, type: "line",
    current: add(surplus?.current ?? zero(), current.retained),
    previous: previous ? add(surplus?.previous ?? zero(), previous.retained) : null,
    accountCode: "3021",
  });
  emit("net.adjustment", "순자산조정", 1, "subtotal", adjustment.sum, adjustment.prevSum);
  rows.push(...adjustment.out);
  const totalNet = add(add(basic.sum, ordinaryTotal), adjustment.sum);
  const totalNetPrev = previous ? add(add(basic.prevSum!, ordinaryPrev!), adjustment.prevSum!) : null;
  emit("net.total", "순자산총계", 0, "total", totalNet, totalNetPrev);
  const grand = add(totalLiab, totalNet);
  emit("grand.total", "부채 및 순자산 총계", 0, "total", grand, totalLiabPrev && totalNetPrev ? add(totalLiabPrev, totalNetPrev) : null);

  const balancedOf = (a: Amounts, b: Amounts) => a.total === b.total && a.public === b.public && a.other === b.other;
  return {
    asOf, previousAsOf, rows,
    totals: { assets: totalAssets, liabilities: totalLiab, netAssets: totalNet },
    previousTotals: previous ? { assets: totalAssetsPrev, liabilities: totalLiabPrev, netAssets: totalNetPrev } : null,
    balanced: balancedOf(totalAssets, grand) && (!previous || balancedOf(totalAssetsPrev!, add(totalLiabPrev!, totalNetPrev!))),
  };
}

interface ProfitRow {
  code: string; name: string; statementLine: string; nature: string | null; functionCode: string | null;
  programId: number | null; isOther: boolean; kind: string; amount: number;
}

/** 기간의 수익·비용. amount는 수익이면 대변 − 차변, 비용이면 차변 − 대변이다. */
async function profitRows(from: string, to: string): Promise<ProfitRow[]> {
  const rows = rowsOf(await db.execute(sql`
    WITH ${SEGMENT_CTE}
    SELECT a.code, a.name, a.statement_line, a.nature, a.kind, l.function_code, l.program_id, seg.is_other,
           COALESCE(SUM(l.debit - l.credit), 0)::bigint AS net
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
      JOIN seg ON seg.voucher_id = l.voucher_id
     WHERE v.status = 'approved' AND v.is_template = FALSE
       AND v.voucher_date BETWEEN ${from} AND ${to}
       AND a.kind IN ('revenue', 'expense')
     GROUP BY a.code, a.name, a.statement_line, a.nature, a.kind, l.function_code, l.program_id, seg.is_other
     ORDER BY a.code`));
  return rows.map((r: any) => {
    const net = Number(r.net) || 0;
    return {
      code: r.code, name: r.name, statementLine: r.statement_line, nature: r.nature, kind: r.kind,
      functionCode: r.function_code, programId: r.program_id == null ? null : Number(r.program_id),
      isOther: r.is_other === true || r.is_other === "t",
      amount: r.kind === "revenue" ? -net : net,
    };
  });
}

async function programNames(): Promise<Map<number, { name: string; code: string; sort: number }>> {
  const map = new Map<number, { name: string; code: string; sort: number }>();
  for (const r of rowsOf(await db.execute(sql`SELECT id, code, name, sort_order FROM ledger_programs`))) {
    map.set(Number(r.id), { name: r.name, code: r.code, sort: Number(r.sort_order) || 0 });
  }
  return map;
}

const sumWhere = (rows: ProfitRow[], test: (r: ProfitRow) => boolean): Amounts => {
  const out = zero();
  for (const r of rows) if (test(r)) bump(out, r.amount, r.isOther);
  return out;
};

const DONATION_LINES = ["donation_individual", "donation_corporate", "donation_org", "donation_other"];

/** 운영성과표(별지 2호) */
export async function operatingStatement(from: string, to: string, prevFrom: string | null = null, prevTo: string | null = null) {
  const cur = await profitRows(from, to);
  const prev = prevFrom && prevTo ? await profitRows(prevFrom, prevTo) : null;
  const names = await programNames();
  const rows: StatementRow[] = [];
  const both = (test: (r: ProfitRow) => boolean) => ({ current: sumWhere(cur, test), previous: prev ? sumWhere(prev, test) : null });
  const push = (key: string, label: string, level: number, type: StatementRow["type"], a: { current: Amounts; previous: Amounts | null }, warning?: string) =>
    rows.push({ key, label, level, type, ...a, ...(warning ? { warning } : {}) });
  const skip = (a: { current: Amounts; previous: Amounts | null }) => isZero(a.current) && isZero(a.previous);

  /* 사업수익 */
  const isBusinessRevenue = (r: ProfitRow) => r.kind === "revenue" && r.statementLine !== "non_operating_revenue";
  const businessRevenue = both(isBusinessRevenue);
  push("revenue", "사업수익", 0, "subtotal", businessRevenue);
  const donation = both((r) => DONATION_LINES.includes(r.statementLine));
  push("revenue.donation", "기부금수익", 1, "line", donation);
  const donationAccounts = new Map<string, string>();
  for (const r of [...cur, ...(prev ?? [])]) if (DONATION_LINES.includes(r.statementLine)) donationAccounts.set(r.code, r.name);
  for (const [code, name] of donationAccounts) push(`revenue.donation.${code}`, name, 2, "line", both((r) => r.code === code));
  const grant = both((r) => r.statementLine === "grant");
  if (!skip(grant)) push("revenue.grant", "보조금수익", 1, "line", grant);
  const fee = both((r) => r.statementLine === "membership_fee");
  if (!skip(fee)) push("revenue.fee", "회비수익", 1, "line", fee);
  const otherRevenue = both((r) => isBusinessRevenue(r) && !DONATION_LINES.includes(r.statementLine)
    && r.statementLine !== "grant" && r.statementLine !== "membership_fee");
  if (!skip(otherRevenue)) push("revenue.other", "기타공익목적사업수익", 1, "line", otherRevenue);

  /* 사업비용 */
  const isBusinessExpense = (r: ProfitRow) => r.kind === "expense" && r.statementLine === "business_expense";
  const businessExpense = both(isBusinessExpense);
  push("expense", "사업비용", 0, "subtotal", businessExpense);
  const service = both((r) => isBusinessExpense(r) && r.functionCode === "service");
  push("expense.service", "사업수행비용", 1, "line", service);
  const programIds = new Set<number | null>();
  for (const r of [...cur, ...(prev ?? [])]) if (isBusinessExpense(r) && r.functionCode === "service") programIds.add(r.programId);
  const orderedPrograms = [...programIds].sort((a, b) =>
    (a == null ? 9999 : names.get(a)?.sort ?? 0) - (b == null ? 9999 : names.get(b)?.sort ?? 0));
  for (const id of orderedPrograms) {
    const label = id == null ? "사업 미지정" : `${names.get(id)?.name ?? id} 사업수행비용`;
    push(`expense.service.${id ?? "none"}`, label, 2, "line",
      both((r) => isBusinessExpense(r) && r.functionCode === "service" && r.programId === id),
      id == null ? "사업을 지정해야 합니다" : undefined);
  }
  push("expense.admin", "일반관리비용", 1, "line", both((r) => isBusinessExpense(r) && r.functionCode === "admin"));
  push("expense.fundraising", "모금비용", 1, "line", both((r) => isBusinessExpense(r) && r.functionCode === "fundraising"));
  const untagged = both((r) => isBusinessExpense(r) && !r.functionCode);
  if (!skip(untagged)) push("expense.untagged", "활동 미지정 비용", 1, "line", untagged, "활동을 지정해야 합니다");

  const businessProfit = {
    current: minus(businessRevenue.current, businessExpense.current),
    previous: prev ? minus(businessRevenue.previous!, businessExpense.previous!) : null,
  };
  push("profit.business", "사업이익(손실)", 0, "total", businessProfit);

  /* 사업외 */
  const detail = (keyPrefix: string, test: (r: ProfitRow) => boolean) => {
    const accounts = new Map<string, string>();
    for (const r of [...cur, ...(prev ?? [])]) if (test(r)) accounts.set(r.code, r.name);
    for (const [code, name] of accounts) push(`${keyPrefix}.${code}`, name, 1, "line", both((r) => test(r) && r.code === code));
  };
  const isNonOpRevenue = (r: ProfitRow) => r.kind === "revenue" && r.statementLine === "non_operating_revenue";
  const isNonOpExpense = (r: ProfitRow) => r.kind === "expense" && r.statementLine === "non_operating_expense";
  const nonOpRevenue = both(isNonOpRevenue);
  const nonOpExpense = both(isNonOpExpense);
  push("nonop.revenue", "사업외수익", 0, "subtotal", nonOpRevenue);
  detail("nonop.revenue", isNonOpRevenue);
  push("nonop.expense", "사업외비용", 0, "subtotal", nonOpExpense);
  detail("nonop.expense", isNonOpExpense);

  const preTax = {
    current: minus(add(businessProfit.current, nonOpRevenue.current), nonOpExpense.current),
    previous: prev ? minus(add(businessProfit.previous!, nonOpRevenue.previous!), nonOpExpense.previous!) : null,
  };
  push("profit.pretax", "법인세비용차감전 당기운영이익(손실)", 0, "total", preTax);
  const tax = both((r) => r.kind === "expense" && r.statementLine === "income_tax");
  push("tax", "법인세비용", 1, "line", tax);
  const net = {
    current: minus(preTax.current, tax.current),
    previous: prev ? minus(preTax.previous!, tax.previous!) : null,
  };
  push("profit.net", "당기운영이익(손실)", 0, "total", net);

  return {
    period: { from, to }, previousPeriod: prevFrom && prevTo ? { from: prevFrom, to: prevTo } : null,
    rows,
    summary: {
      businessRevenue: businessRevenue.current.total, businessExpense: businessExpense.current.total,
      businessProfit: businessProfit.current.total, nonOpRevenue: nonOpRevenue.current.total,
      nonOpExpense: nonOpExpense.current.total, preTax: preTax.current.total, tax: tax.current.total,
      netIncome: net.current.total,
    },
  };
}

/** 주석: 사업비용의 성격별 구분(제27조, 별지 2호 *2) */
export async function natureBreakdown(from: string, to: string) {
  const rows = (await profitRows(from, to)).filter((r) => r.kind === "expense" && r.statementLine === "business_expense");
  const blank = () => ({ distribution: 0, personnel: 0, facility: 0, other: 0, total: 0 });
  const out: Record<string, ReturnType<typeof blank>> = { service: blank(), admin: blank(), fundraising: blank(), otherSegment: blank() };
  for (const r of rows) {
    const key = r.isOther ? "otherSegment" : r.functionCode === "service" || r.functionCode === "fundraising" ? r.functionCode : "admin";
    const nature = r.nature === "distribution" || r.nature === "personnel" || r.nature === "facility" ? r.nature : "other";
    out[key][nature] += r.amount;
    out[key].total += r.amount;
  }
  const publicTotal = blank();
  const grand = blank();
  for (const k of ["distribution", "personnel", "facility", "other", "total"] as const) {
    publicTotal[k] = out.service[k] + out.admin[k] + out.fundraising[k];
    grand[k] = publicTotal[k] + out.otherSegment[k];
  }
  return {
    rows: [
      { key: "public", label: "공익목적사업비용", level: 0, ...publicTotal },
      { key: "service", label: "사업수행비용", level: 1, ...out.service },
      { key: "admin", label: "일반관리비용", level: 1, ...out.admin },
      { key: "fundraising", label: "모금비용", level: 1, ...out.fundraising },
      { key: "otherSegment", label: "기타사업비용", level: 0, ...out.otherSegment },
      { key: "total", label: "합계", level: 0, ...grand },
    ],
  };
}

/** 주석: 순자산의 변동(제41조 12호, 별지 1호 *1) */
export async function netAssetChanges(fy: FiscalYear) {
  const before = await balancesAsOf(dayBefore(fy.startDate));
  const classify = (line: string) => line === "basic_net_asset" ? "basic" : line === "net_asset_adjustment" ? "adjustment" : "ordinary";
  const opening = { basic: 0, ordinary: 0, adjustment: 0 };
  for (const r of before) {
    if (r.kind === "net_asset") opening[classify(r.statementLine)] += -r.net;
    else if (r.kind === "revenue" || r.kind === "expense") opening.ordinary += -r.net;
  }

  const moves = rowsOf(await db.execute(sql`
    SELECT a.statement_line, v.voucher_type, COALESCE(SUM(l.credit - l.debit), 0)::bigint AS amount
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
     WHERE v.status = 'approved' AND v.is_template = FALSE
       AND v.voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}
       AND a.kind = 'net_asset'
     GROUP BY a.statement_line, v.voucher_type`));
  const openingEntry = { basic: 0, ordinary: 0, adjustment: 0 };
  const changes = { basic: 0, ordinary: 0, adjustment: 0 };
  for (const m of moves) {
    const target = m.voucher_type === "opening" ? openingEntry : changes;
    target[classify(m.statement_line)] += Number(m.amount) || 0;
  }

  const { summary } = await operatingStatement(fy.startDate, fy.endDate);
  const net = summary.netIncome;
  const row = (key: string, label: string, basic: number, ordinary: number, adjustment: number) =>
    ({ key, label, basic, ordinary, adjustment, total: basic + ordinary + adjustment });
  const closing = {
    basic: opening.basic + openingEntry.basic + changes.basic,
    ordinary: opening.ordinary + openingEntry.ordinary + changes.ordinary + net,
    adjustment: opening.adjustment + openingEntry.adjustment + changes.adjustment,
  };
  return {
    rows: [
      row("opening", "전기말", opening.basic, opening.ordinary, opening.adjustment),
      row("openingEntry", "개시 잔액", openingEntry.basic, openingEntry.ordinary, openingEntry.adjustment),
      row("change", "순자산 직접 증감", changes.basic, changes.ordinary, changes.adjustment),
      row("net", "당기운영이익(손실)", 0, net, 0),
      row("closing", "당기말", closing.basic, closing.ordinary, closing.adjustment),
    ],
    closing,
  };
}

/** 재원별 수입·지출. 사용이 제한된 재원의 미사용 잔액은 주석 3에 쓴다. */
export async function fundSummary(fy: FiscalYear) {
  const funds = rowsOf(await db.execute(sql`SELECT id, code, name, restricted FROM ledger_funds ORDER BY sort_order, id`));
  const rows = rowsOf(await db.execute(sql`
    SELECT l.fund_id, a.kind, v.voucher_date >= ${fy.startDate} AS in_year,
           COALESCE(SUM(l.credit - l.debit), 0)::bigint AS credit_net
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
     WHERE v.status = 'approved' AND v.is_template = FALSE AND v.voucher_date <= ${fy.endDate}
       AND a.kind IN ('revenue', 'expense') AND l.fund_id IS NOT NULL
     GROUP BY l.fund_id, a.kind, in_year`));
  const map = new Map<number, { opening: number; income: number; spent: number }>();
  for (const f of funds) map.set(Number(f.id), { opening: 0, income: 0, spent: 0 });
  for (const r of rows) {
    const e = map.get(Number(r.fund_id));
    if (!e) continue;
    const amount = Number(r.credit_net) || 0;
    const inYear = r.in_year === true || r.in_year === "t";
    if (!inYear) e.opening += amount;
    else if (r.kind === "revenue") e.income += amount;
    else e.spent += -amount;
  }
  return funds.map((f: any) => {
    const e = map.get(Number(f.id))!;
    return {
      code: f.code, name: f.name, restricted: f.restricted === true || f.restricted === "t",
      opening: e.opening, income: e.income, spent: e.spent, closing: e.opening + e.income - e.spent,
    };
  });
}

/** 주석 8: 총자산 또는 사업수익의 10% 이상 거래. 두 기준 중 낮은 금액을 쓴다. */
export async function majorTransactions(fy: FiscalYear, totalAssets: number, businessRevenue: number) {
  const bases = [totalAssets, businessRevenue].filter((n) => n > 0);
  if (!bases.length) return { threshold: 0, rows: [] as any[] };
  const threshold = Math.ceil(Math.min(...bases) * 0.1);
  const rows = rowsOf(await db.execute(sql`
    SELECT v.payee_name, a.code, a.name, COALESCE(SUM(l.debit + l.credit), 0)::bigint AS amount, COUNT(DISTINCT v.id)::int AS n
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
     WHERE v.status = 'approved' AND v.is_template = FALSE AND v.reversed_by_id IS NULL AND v.voucher_type <> 'reversal'
       AND v.voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}
       AND a.kind IN ('revenue', 'expense')
       AND v.payee_name IS NOT NULL AND v.payee_name <> ''
     GROUP BY v.payee_name, a.code, a.name
    HAVING SUM(l.debit + l.credit) >= ${threshold}
     ORDER BY amount DESC
     LIMIT 50`));
  return {
    threshold,
    rows: rows.map((r: any) => ({ payeeName: r.payee_name, accountCode: r.code, accountName: r.name, amount: Number(r.amount), count: Number(r.n) })),
  };
}

interface BudgetTreeRow {
  key: string; label: string; level: number; code: string; planned: number; actual: number; difference: number; rate: number | null;
}

async function budgetTree(planId: number | null) {
  const accounts = rowsOf(await db.execute(sql`
    SELECT id, level, parent_id, code, name, sort_order FROM budget_accounts ORDER BY sort_order, id`));
  const planned = new Map<number, number>();
  if (planId) {
    for (const r of rowsOf(await db.execute(sql`
      SELECT budget_account_id, planned_amount FROM budget_lines WHERE plan_id = ${planId} AND budget_account_id IS NOT NULL`))) {
      planned.set(Number(r.budget_account_id), Number(r.planned_amount) || 0);
    }
  }
  return { accounts, planned };
}

function treeRows(accounts: any[], planned: Map<number, number>, actual: Map<number, number>): BudgetTreeRow[] {
  const children = new Map<number | null, any[]>();
  for (const a of accounts) {
    const key = a.parent_id == null ? null : Number(a.parent_id);
    children.set(key, [...(children.get(key) ?? []), a]);
  }
  const rows: BudgetTreeRow[] = [];
  const total = (a: any): { planned: number; actual: number } => {
    const kids = children.get(Number(a.id)) ?? [];
    if (!kids.length) return { planned: planned.get(Number(a.id)) ?? 0, actual: actual.get(Number(a.id)) ?? 0 };
    return kids.map(total).reduce((s, x) => ({ planned: s.planned + x.planned, actual: s.actual + x.actual }), { planned: 0, actual: 0 });
  };
  const walk = (a: any, level: number) => {
    const t = total(a);
    if (t.planned === 0 && t.actual === 0) return;
    rows.push({
      key: `budget.${a.id}`, label: a.name, level, code: a.code, planned: t.planned, actual: t.actual,
      difference: t.planned - t.actual, rate: t.planned > 0 ? Math.round((t.actual / t.planned) * 1000) / 10 : null,
    });
    for (const kid of children.get(Number(a.id)) ?? []) walk(kid, level + 1);
  };
  for (const root of children.get(null) ?? []) walk(root, 0);
  return rows;
}

async function cashAt(asOf: string): Promise<number> {
  const r = rowsOf(await db.execute(sql`
    SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint AS balance
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
     WHERE v.status = 'approved' AND v.is_template = FALSE AND v.voucher_date <= ${asOf}
       AND a.parent_code = ${CASH_PARENT}`))[0];
  return Number(r?.balance) || 0;
}

/** 개시 전표로 들어온 현금. 전기이월로 본다. */
async function openingCash(fy: FiscalYear): Promise<number> {
  const r = rowsOf(await db.execute(sql`
    SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint AS balance
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
     WHERE v.status = 'approved' AND v.is_template = FALSE AND v.voucher_type = 'opening'
       AND v.voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}
       AND a.parent_code = ${CASH_PARENT}`))[0];
  return Number(r?.balance) || 0;
}

/** 수지결산서(정관 제33조). 수입은 계정, 지출은 관·항·목. */
export async function settlementStatement(fy: FiscalYear) {
  const plan = rowsOf(await db.execute(sql`
    SELECT id, status, title FROM budget_plans WHERE fiscal_year = ${fy.year} LIMIT 1`))[0];
  const planId = plan ? Number(plan.id) : null;
  const { accounts, planned } = await budgetTree(planId);

  /* 수입 */
  const profit = await profitRows(fy.startDate, fy.endDate);
  const actualRevenue = new Map<string, { name: string; actual: number; planned: number }>();
  for (const r of profit) {
    if (r.kind !== "revenue") continue;
    const e = actualRevenue.get(r.code) ?? { name: r.name, actual: 0, planned: 0 };
    e.actual += r.amount;
    actualRevenue.set(r.code, e);
  }
  if (planId) {
    for (const r of rowsOf(await db.execute(sql`
      SELECT b.account_code, b.planned_amount, a.name FROM budget_revenue_lines b
        JOIN account_codes a ON a.code = b.account_code WHERE b.plan_id = ${planId}`))) {
      const e = actualRevenue.get(r.account_code) ?? { name: r.name, actual: 0, planned: 0 };
      e.planned += Number(r.planned_amount) || 0;
      actualRevenue.set(r.account_code, e);
    }
  }
  const revenueRows = [...actualRevenue.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, e]) => ({
    key: `rev.${code}`, label: e.name, level: 0, code, planned: e.planned, actual: e.actual,
    difference: e.planned - e.actual, rate: e.planned > 0 ? Math.round((e.actual / e.planned) * 1000) / 10 : null,
  }));

  /* 지출: 지출 연결 → 전표의 예산 줄 → 계정의 목 순서로 찾는다 */
  const lines = rowsOf(await db.execute(sql`
    SELECT l.account_code, a.category, a.statement_line, a.name,
           e.budget_account_id AS expense_mok, bl.budget_account_id AS line_mok,
           COALESCE(SUM(l.debit - l.credit), 0)::bigint AS amount
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
      LEFT JOIN vouchers orig ON orig.id = v.reversal_of_id
      LEFT JOIN expenses e ON e.id = COALESCE(v.expense_id, orig.expense_id)
      LEFT JOIN budget_lines bl ON bl.id = COALESCE(v.budget_line_id, orig.budget_line_id)
     WHERE v.status = 'approved' AND v.is_template = FALSE
       AND v.voucher_date BETWEEN ${fy.startDate} AND ${fy.endDate}
       AND a.kind = 'expense'
     GROUP BY l.account_code, a.category, a.statement_line, a.name, e.budget_account_id, bl.budget_account_id`));
  const toMok = await loadAccountToMok();
  const actual = new Map<number, number>();
  let unassigned = 0;
  const extra = new Map<string, number>();
  for (const r of lines) {
    const amount = Number(r.amount) || 0;
    if (!amount) continue;
    if (r.statement_line !== "business_expense") {
      const label = r.statement_line === "income_tax" ? "법인세비용" : "사업외비용";
      extra.set(label, (extra.get(label) ?? 0) + amount);
      continue;
    }
    const mok = r.expense_mok != null ? Number(r.expense_mok) : r.line_mok != null ? Number(r.line_mok) : toMok(r.account_code, r.category);
    if (mok == null) unassigned += amount;
    else actual.set(mok, (actual.get(mok) ?? 0) + amount);
  }
  const expenseRows = treeRows(accounts, planned, actual);
  if (unassigned !== 0) {
    expenseRows.push({ key: "budget.none", label: "예산 미배정", level: 0, code: "", planned: 0, actual: unassigned, difference: -unassigned, rate: null });
  }
  for (const [label, amount] of extra) {
    expenseRows.push({ key: `budget.${label}`, label, level: 0, code: "", planned: 0, actual: amount, difference: -amount, rate: null });
  }

  const sumRows = (rows: { planned: number; actual: number; level: number }[]) =>
    rows.filter((r) => r.level === 0).reduce((s, r) => ({ planned: s.planned + r.planned, actual: s.actual + r.actual }), { planned: 0, actual: 0 });
  const revenueTotal = sumRows(revenueRows);
  const expenseTotal = sumRows(expenseRows);

  const carryIn = (await cashAt(dayBefore(fy.startDate))) + (await openingCash(fy));
  const carryOut = await cashAt(fy.endDate);
  /* 장부는 발생주의라 수입 − 지출이 현금 증감과 다르다. 미수·미지급·비현금 비용의 차이를 한 행으로 보인다 */
  const otherChange = carryOut - carryIn - (revenueTotal.actual - expenseTotal.actual);
  return {
    plan: plan ? { id: planId, status: plan.status, title: plan.title } : null,
    revenueRows, expenseRows, revenueTotal, expenseTotal,
    carryIn, carryOut, otherChange,
    incomeSide: carryIn + revenueTotal.actual + (otherChange > 0 ? otherChange : 0),
    outflowSide: expenseTotal.actual + carryOut + (otherChange < 0 ? -otherChange : 0),
  };
}

/** 다음 해 수지예산서. 예산안이 없으면 null */
export async function budgetStatement(year: number) {
  const plan = rowsOf(await db.execute(sql`
    SELECT id, status, title, carry_in, total_planned FROM budget_plans WHERE fiscal_year = ${year} LIMIT 1`))[0];
  if (!plan) return null;
  const planId = Number(plan.id);
  const { accounts, planned } = await budgetTree(planId);
  const expenseRows = treeRows(accounts, planned, new Map());
  const revenueRows = rowsOf(await db.execute(sql`
    SELECT b.account_code, b.planned_amount, b.prev_year_actual, b.note, a.name, f.name AS fund_name
      FROM budget_revenue_lines b
      JOIN account_codes a ON a.code = b.account_code
      LEFT JOIN ledger_funds f ON f.id = b.fund_id
     WHERE b.plan_id = ${planId}
     ORDER BY b.account_code`)).map((r: any) => ({
    code: r.account_code, label: r.name, fundName: r.fund_name, planned: Number(r.planned_amount) || 0,
    prevYearActual: Number(r.prev_year_actual) || 0, note: r.note,
  }));
  const revenueTotal = revenueRows.reduce((s: number, r: any) => s + r.planned, 0);
  const expenseTotal = expenseRows.filter((r) => r.level === 0).reduce((s, r) => s + r.planned, 0);
  const carryIn = Number(plan.carry_in) || 0;

  const byProgram = rowsOf(await db.execute(sql`
    SELECT s.program_id, s.function_code, COALESCE(SUM(s.amount), 0)::bigint AS amount
      FROM budget_line_splits s
      JOIN budget_lines l ON l.id = s.line_id
     WHERE l.plan_id = ${planId}
     GROUP BY s.program_id, s.function_code`));
  return {
    year, planId, status: plan.status, title: plan.title, revenueRows, expenseRows,
    revenueTotal, expenseTotal, carryIn, carryOut: carryIn + revenueTotal - expenseTotal,
    programBudgets: byProgram.map((r: any) => ({
      programId: r.program_id == null ? null : Number(r.program_id), functionCode: r.function_code, amount: Number(r.amount) || 0,
    })),
  };
}

/** 재무상태표에 나온 자산 계정 잔액. 재산목록과 맞춰 본다. */
export async function assetBalances(asOf: string) {
  const rows = await balancesAsOf(asOf);
  const map = new Map<string, { code: string; name: string; statementLine: string; amount: number }>();
  for (const r of rows) {
    if (r.kind !== "asset") continue;
    const e = map.get(r.code) ?? { code: r.code, name: r.name, statementLine: r.statementLine, amount: 0 };
    e.amount += r.net;
    map.set(r.code, e);
  }
  return [...map.values()].filter((e) => e.amount !== 0);
}

/** 손익 현황이 쓰는 월별 전표 비용. 지출에서 만든 전표는 지출 합계에 있으므로 뺀다. */
export async function voucherCostsInPeriod(from: string, to: string): Promise<{ month: number; amount: number }[]> {
  const rows = rowsOf(await db.execute(sql`
    SELECT EXTRACT(MONTH FROM v.voucher_date)::int AS month, COALESCE(SUM(l.debit - l.credit), 0)::bigint AS amount
      FROM voucher_lines l
      JOIN vouchers v ON v.id = l.voucher_id
      JOIN account_codes a ON a.code = l.account_code
      LEFT JOIN vouchers orig ON orig.id = v.reversal_of_id
     WHERE v.status = 'approved' AND v.is_template = FALSE
       AND v.voucher_date BETWEEN ${from} AND ${to}
       AND a.statement_line = 'business_expense'
       AND COALESCE(v.source_type, '') NOT IN ('expense', 'expense_refund')
       AND COALESCE(orig.source_type, '') NOT IN ('expense', 'expense_refund')
     GROUP BY 1`));
  return rows.map((r: any) => ({ month: Number(r.month), amount: Number(r.amount) || 0 })).filter((r) => r.amount !== 0);
}

export function fiscalYearOf(years: FiscalYear[], year: number): FiscalYear | undefined {
  return years.find((f) => f.year === year);
}

/** 회계연도 재무제표 두 장. 전기 장부가 있으면 비교한다. */
export async function yearStatements(year: number) {
  const years = await loadFiscalYears();
  const fy = fiscalYearOf(years, year);
  if (!fy) return null;
  const prev = fiscalYearOf(years, year - 1) ?? null;
  const balance = await balanceSheet(fy.endDate, prev?.endDate ?? null);
  const operating = await operatingStatement(fy.startDate, fy.endDate, prev?.startDate ?? null, prev?.endDate ?? null);
  return { fy, previous: prev, balance, operating };
}

