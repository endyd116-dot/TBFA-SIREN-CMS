// lib/ledger-post.ts — 복식 전표 저장·검사·승인·취소의 단일 출처 (2026-11-06)
//
// 설계: docs/active/2026-11-06-ledger-foundation-design.md
// 승인은 postVoucher, 취소는 reverseVoucher로만 한다. 화면과 AI 도구가 같은 경로를 쓴다.
// DB 안전장치가 최종 방어선이고, 여기서는 운영자가 이해할 수 있는 안내를 만든다.
// 연결 1개(max:1) 환경이라 트랜잭션 안에서는 인자로 받은 tx만 쓴다.
import { sql } from "drizzle-orm";
import { nextVoucherNumber } from "./voucher-number";

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];

export function ymd(d: any): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d ?? "").slice(0, 10);
}

export const LEDGER_FUNCTIONS = [
  { code: "service", label: "사업수행" },
  { code: "admin", label: "일반관리" },
  { code: "fundraising", label: "모금" },
] as const;
const FUNCTION_CODES: string[] = LEDGER_FUNCTIONS.map((f) => f.code);

export const VOUCHER_TYPES = ["expense", "income", "transfer", "opening", "reversal"] as const;

export interface LedgerLine {
  accountCode: string;
  debit: number;
  credit: number;
  functionCode: string | null;
  programId: number | null;
  fundId: number | null;
  memo: string | null;
}

export interface LedgerActor {
  id: number | null;
  name: string;
}

export interface LedgerAccount {
  code: string;
  name: string;
  kind: string;
  normalSide: string;
  statementLine: string;
  nature: string | null;
  defaultFunction: string | null;
  isActive: boolean;
  hasChildren: boolean;
}

/** 운영자에게 그대로 보여 줄 수 있는 거절. status는 HTTP 응답 코드 */
export class LedgerError extends Error {
  status: number;
  missing: string[];
  constructor(message: string, status = 422, missing: string[] = []) {
    super(message);
    this.name = "LedgerError";
    this.status = status;
    this.missing = missing;
  }
}

const toAmount = (v: unknown): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const toId = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export interface RuleLine {
  functionCode: string;
  programId: number | null;
  fundId: number | null;
  ratio: number;
}

/** 배분 규칙 입력을 검사한다. 비율 합은 100이어야 한다. */
export function normalizeRuleLines(raw: unknown): RuleLine[] {
  const lines: RuleLine[] = (Array.isArray(raw) ? raw : []).map((item: any) => ({
    functionCode: String(item?.functionCode ?? ""),
    programId: toId(item?.programId),
    fundId: toId(item?.fundId),
    ratio: Number(item?.ratio) || 0,
  })).filter((l) => l.ratio > 0);
  if (lines.length < 2) throw new LedgerError("배분 대상을 2개 이상 입력하세요.", 400);
  for (const l of lines) {
    if (!FUNCTION_CODES.includes(l.functionCode)) throw new LedgerError("활동을 고르세요.", 400);
    if (l.functionCode === "service" && !l.programId) throw new LedgerError("사업수행은 사업을 골라야 합니다.", 400);
    if (l.functionCode !== "service") l.programId = null;
  }
  const sum = Math.round(lines.reduce((t, l) => t + l.ratio, 0) * 100) / 100;
  if (sum !== 100) throw new LedgerError(`비율의 합이 100이어야 합니다. 지금 ${sum}`, 400);
  return lines;
}

/** 금액을 비율대로 나눈다. 반올림 차이는 가장 큰 몫에 더해 합계가 항상 맞게 한다. */
export function splitByRatio<T extends { ratio: number }>(amount: number, lines: T[]): (T & { amount: number })[] {
  const parts = lines.map((l) => ({ ...l, amount: Math.floor((amount * l.ratio) / 100) }));
  const left = amount - parts.reduce((t, p) => t + p.amount, 0);
  if (left && parts.length) {
    let biggest = 0;
    parts.forEach((p, i) => { if (p.ratio > parts[biggest].ratio) biggest = i; });
    parts[biggest].amount += left;
  }
  return parts.filter((p) => p.amount > 0);
}

/** 화면·AI 입력을 줄 형식으로 정리한다. 금액이 없는 빈 줄은 버린다. */
export function normalizeLines(raw: unknown): LedgerLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: LedgerLine[] = [];
  for (const item of raw as any[]) {
    const accountCode = String(item?.accountCode ?? item?.account_code ?? "").trim();
    const debit = toAmount(item?.debit);
    const credit = toAmount(item?.credit);
    if (!accountCode || (debit === 0 && credit === 0)) continue;
    const fn = String(item?.functionCode ?? item?.function_code ?? "").trim();
    lines.push({
      accountCode,
      debit,
      credit,
      functionCode: fn || null,
      programId: toId(item?.programId ?? item?.program_id),
      fundId: toId(item?.fundId ?? item?.fund_id),
      memo: item?.memo ? String(item.memo).slice(0, 200) : null,
    });
  }
  return lines;
}

export async function loadAccounts(tx: any, codes: string[]): Promise<Map<string, LedgerAccount>> {
  const map = new Map<string, LedgerAccount>();
  const unique = [...new Set(codes)];
  if (!unique.length) return map;
  const res = await tx.execute(sql`
    SELECT a.code, a.name, a.kind, a.normal_side, a.statement_line, a.nature, a.default_function, a.is_active,
           EXISTS (SELECT 1 FROM account_codes c WHERE c.parent_code = a.code) AS has_children
      FROM account_codes a
     WHERE a.code IN (${sql.join(unique.map((c) => sql`${c}`), sql`, `)})`);
  for (const r of rowsOf(res)) {
    map.set(r.code, {
      code: r.code,
      name: r.name,
      kind: r.kind,
      normalSide: r.normal_side,
      statementLine: r.statement_line,
      nature: r.nature,
      defaultFunction: r.default_function,
      isActive: r.is_active,
      hasChildren: r.has_children === true || r.has_children === "t",
    });
  }
  return map;
}

export async function accountByRole(tx: any, role: string): Promise<{ code: string; name: string }> {
  const r = rowsOf(await tx.execute(sql`
    SELECT code, name FROM account_codes WHERE system_role = ${role} AND is_active = TRUE LIMIT 1`))[0];
  if (!r) throw new LedgerError(`기본 계정이 지정되어 있지 않습니다: ${role}`, 500);
  return { code: r.code, name: r.name };
}

/** 날짜가 장부 기간 안이고 마감되지 않았는지 확인한다. 문제가 없으면 null */
export async function periodProblem(tx: any, voucherDate: string): Promise<string | null> {
  const fy = rowsOf(await tx.execute(sql`
    SELECT year, start_date, end_date, closed_through, status
      FROM ledger_fiscal_years
     WHERE ${voucherDate}::date BETWEEN start_date AND end_date
     LIMIT 1`))[0];
  if (!fy) return `${voucherDate}은 장부 기간 밖의 날짜입니다.`;
  if (fy.status !== "open") return `${fy.year}년은 결산이 끝났습니다.`;
  if (fy.closed_through && voucherDate <= ymd(fy.closed_through)) {
    return `${ymd(fy.closed_through)}까지 마감되어 ${voucherDate} 전표를 승인할 수 없습니다.`;
  }
  return null;
}

/**
 * 분개 검사. strict=false는 작성중 저장용으로 계정 유효성만 본다.
 * strict=true는 제출·승인용이며 빠진 항목을 모두 모아 돌려준다.
 * 계정 정보를 이미 가진 자동 전표도 쓰도록 DB를 보지 않는다.
 */
export function lineProblems(lines: LedgerLine[], accounts: Map<string, LedgerAccount>, strict: boolean): string[] {
  const problems: string[] = [];
  lines.forEach((line, index) => {
    const label = `${index + 1}번째 줄`;
    const account = accounts.get(line.accountCode);
    if (!account) {
      problems.push(`${label}: 없는 계정과목입니다 (${line.accountCode}).`);
      return;
    }
    if (line.debit > 0 && line.credit > 0) {
      problems.push(`${label}: 차변과 대변 중 한쪽에만 금액을 넣으세요.`);
    }
    if (line.functionCode && !FUNCTION_CODES.includes(line.functionCode)) {
      problems.push(`${label}: 알 수 없는 활동입니다.`);
    }
    if (!strict) return;

    if (!account.isActive) problems.push(`${label}: 사용 중지된 계정입니다 (${account.name}).`);
    if (account.hasChildren) problems.push(`${label}: ${account.name} 계정은 묶음 계정입니다. 하위 계정을 고르세요.`);

    const isBusinessExpense = account.statementLine === "business_expense";
    const isIncomeOrExpense = account.kind === "revenue" || account.kind === "expense";
    if (isBusinessExpense) {
      if (!line.functionCode) problems.push(`${label}: 활동을 고르세요 (${account.name}).`);
      if (line.functionCode === "service" && !line.programId) {
        problems.push(`${label}: 사업수행 비용은 사업을 고르세요 (${account.name}).`);
      }
      if (account.nature === "distribution" && line.functionCode && line.functionCode !== "service") {
        problems.push(`${label}: ${account.name} 계정은 사업수행에서만 쓸 수 있습니다.`);
      }
    }
    if (isIncomeOrExpense && !line.fundId) problems.push(`${label}: 재원을 고르세요 (${account.name}).`);
  });

  if (strict) {
    const dr = lines.reduce((sum, l) => sum + l.debit, 0);
    const cr = lines.reduce((sum, l) => sum + l.credit, 0);
    if (lines.length < 2) problems.push("분개는 2줄 이상이어야 합니다.");
    if (dr === 0 || dr !== cr) {
      problems.push(`차변 합계(${dr.toLocaleString("ko-KR")}원)와 대변 합계(${cr.toLocaleString("ko-KR")}원)가 맞지 않습니다.`);
    }
  }
  return problems;
}

export async function validateLines(
  tx: any,
  input: { voucherDate: string; lines: LedgerLine[]; strict: boolean },
): Promise<string[]> {
  const { voucherDate, lines, strict } = input;
  const accounts = await loadAccounts(tx, lines.map((l) => l.accountCode));
  const problems = lineProblems(lines, accounts, strict);
  if (strict) {
    const period = await periodProblem(tx, voucherDate);
    if (period) problems.push(period);
  }
  return problems;
}

/** 줄을 저장할 때의 활동·사업·재원·부문. 해당 없는 값은 비운다. */
export function storedLine(line: LedgerLine, account: LedgerAccount | undefined, segments: Map<number, string>) {
  const isIncomeOrExpense = account?.kind === "revenue" || account?.kind === "expense";
  const isBusinessExpense = account?.statementLine === "business_expense";
  return {
    functionCode: isBusinessExpense ? line.functionCode : null,
    programId: isBusinessExpense && line.functionCode !== "service" ? null : line.programId,
    fundId: isIncomeOrExpense ? line.fundId : null,
    segment: line.programId ? segments.get(line.programId) ?? "public" : "public",
  };
}

/** 머리표에 저장할 대표 계정과 금액. 기존 목록·이상 감지가 이 값을 읽는다. */
export function headerFromLines(lines: LedgerLine[], accounts: Map<string, LedgerAccount>) {
  const income = lines.find((l) => {
    const kind = accounts.get(l.accountCode)?.kind;
    return kind === "expense" || kind === "revenue";
  });
  const main = income ?? lines.find((l) => l.debit > 0) ?? lines[0];
  const account = main ? accounts.get(main.accountCode) : undefined;
  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  return { accountCode: main?.accountCode ?? "", accountName: account?.name ?? "", amount: Math.max(dr, cr) };
}

export async function loadLines(tx: any, voucherId: number): Promise<LedgerLine[]> {
  const res = await tx.execute(sql`
    SELECT account_code, debit, credit, function_code, program_id, fund_id, memo
      FROM voucher_lines WHERE voucher_id = ${voucherId} ORDER BY line_no`);
  return rowsOf(res).map((r: any) => ({
    accountCode: r.account_code,
    debit: Number(r.debit),
    credit: Number(r.credit),
    functionCode: r.function_code,
    programId: r.program_id == null ? null : Number(r.program_id),
    fundId: r.fund_id == null ? null : Number(r.fund_id),
    memo: r.memo,
  }));
}

/** 분개 줄을 통째로 교체하고 머리표의 대표 계정·금액을 맞춘다. */
export async function saveLines(tx: any, voucherId: number, lines: LedgerLine[]): Promise<void> {
  const accounts = await loadAccounts(tx, lines.map((l) => l.accountCode));
  const programIds = [...new Set(lines.map((l) => l.programId).filter((v): v is number => v != null))];
  const segments = new Map<number, string>();
  if (programIds.length) {
    const res = await tx.execute(sql`
      SELECT id, segment FROM ledger_programs
       WHERE id IN (${sql.join(programIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const r of rowsOf(res)) segments.set(Number(r.id), r.segment);
  }

  await tx.execute(sql`DELETE FROM voucher_lines WHERE voucher_id = ${voucherId}`);
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    const stored = storedLine(line, accounts.get(line.accountCode), segments);
    await tx.execute(sql`
      INSERT INTO voucher_lines
        (voucher_id, line_no, account_code, debit, credit, function_code, program_id, fund_id, segment, memo)
      VALUES
        (${voucherId}, ${lineNo}, ${line.accountCode}, ${line.debit}, ${line.credit},
         ${stored.functionCode}, ${stored.programId}, ${stored.fundId}, ${stored.segment}, ${line.memo})`);
  }

  const header = headerFromLines(lines, accounts);
  if (header.accountCode) {
    await tx.execute(sql`
      UPDATE vouchers
         SET account_code = ${header.accountCode}, account_name = ${header.accountName},
             amount = ${header.amount}, updated_at = NOW()
       WHERE id = ${voucherId}`);
  }
}

/**
 * 줄 없이 만들어진 전표(통장 분류, 반복 틀, AI 도구)의 기본 2줄.
 * 주의: bank_transactions.txn_type의 debit은 출금이라 장부 차변과 뜻이 반대다.
 */
export async function buildDefaultLines(tx: any, voucher: any): Promise<LedgerLine[]> {
  const code = String(voucher.account_code ?? "");
  const amount = Math.abs(Number(voucher.amount) || 0);
  const account = (await loadAccounts(tx, [code])).get(code);
  if (!account || amount === 0) return [];

  let bankTxnType: string | null = null;
  if (voucher.bank_txn_id) {
    const row = rowsOf(await tx.execute(sql`
      SELECT txn_type FROM bank_transactions WHERE id = ${Number(voucher.bank_txn_id)} LIMIT 1`))[0];
    bankTxnType = row?.txn_type ?? null;
  }

  const empty = { functionCode: account.defaultFunction, programId: null, fundId: null, memo: null };
  const pair = (debitCode: string, creditCode: string): LedgerLine[] => [
    { accountCode: debitCode, debit: amount, credit: 0, ...empty },
    { accountCode: creditCode, debit: 0, credit: amount, ...empty },
  ];

  if (account.kind === "expense") {
    const other = bankTxnType ? await accountByRole(tx, "cash_default") : await accountByRole(tx, "payable_default");
    return pair(code, other.code);
  }
  if (account.kind === "revenue") {
    const other = bankTxnType ? await accountByRole(tx, "cash_default") : await accountByRole(tx, "receivable_default");
    return pair(other.code, code);
  }
  if (bankTxnType) {
    const cash = await accountByRole(tx, "cash_default");
    return bankTxnType === "credit" ? pair(cash.code, code) : pair(code, cash.code);
  }
  return [];
}

export async function recordHistory(
  tx: any,
  entry: {
    entity: string;
    entityId: string | number;
    action: string;
    actor: LedgerActor;
    reason?: string | null;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  const before = entry.before === undefined ? null : JSON.stringify(entry.before);
  const after = entry.after === undefined ? null : JSON.stringify(entry.after);
  await tx.execute(sql`
    INSERT INTO ledger_history (entity, entity_id, action, actor_id, actor_name, reason, before_data, after_data)
    VALUES (${entry.entity}, ${String(entry.entityId)}, ${entry.action}, ${entry.actor.id}, ${entry.actor.name},
            ${entry.reason ?? null}, ${before}::jsonb, ${after}::jsonb)`);
}

async function lockVoucher(tx: any, id: number): Promise<any> {
  const voucher = rowsOf(await tx.execute(sql`SELECT * FROM vouchers WHERE id = ${id} FOR UPDATE`))[0];
  if (!voucher) throw new LedgerError("전표를 찾을 수 없습니다", 404);
  return voucher;
}

/** 제출 전 검사. 줄이 없으면 기본 2줄을 만들고, 빠진 항목이 있으면 거절한다. */
export async function prepareSubmit(tx: any, id: number): Promise<any> {
  const voucher = await lockVoucher(tx, id);
  if (voucher.is_template) throw new LedgerError("반복 전표 틀은 제출할 수 없습니다.");
  if (voucher.status !== "draft" && voucher.status !== "rejected") {
    throw new LedgerError(`작성중이나 반려 상태에서만 제출할 수 있습니다 (현재: ${voucher.status})`);
  }
  let lines = await loadLines(tx, id);
  if (!lines.length) {
    lines = await buildDefaultLines(tx, voucher);
    if (!lines.length) throw new LedgerError("분개가 없습니다. 작성 창에서 차변과 대변을 입력하세요.");
    await saveLines(tx, id, lines);
  }
  const problems = await validateLines(tx, { voucherDate: ymd(voucher.voucher_date), lines, strict: true });
  if (problems.length) throw new LedgerError("전표에 빠진 항목이 있습니다.", 422, problems);
  return voucher;
}

/** 승인의 유일한 경로. 호출자는 트랜잭션을 열어 tx를 넘긴다. */
export async function postVoucher(tx: any, id: number, actor: LedgerActor, approverRef: string): Promise<any> {
  const voucher = await lockVoucher(tx, id);
  if (voucher.is_template) throw new LedgerError("반복 전표 틀은 승인할 수 없습니다.");
  if (voucher.status !== "submitted") {
    throw new LedgerError(`승인 대기 상태에서만 승인할 수 있습니다 (현재: ${voucher.status})`);
  }
  const lines = await loadLines(tx, id);
  if (!lines.length) throw new LedgerError("분개가 없는 전표는 승인할 수 없습니다.");
  const problems = await validateLines(tx, { voucherDate: ymd(voucher.voucher_date), lines, strict: true });
  if (problems.length) throw new LedgerError("전표에 빠진 항목이 있습니다.", 422, problems);

  await tx.execute(sql`
    UPDATE vouchers
       SET status = 'approved', approved_by = ${approverRef}, approved_at = NOW(),
           rejection_reason = NULL, updated_at = NOW()
     WHERE id = ${id}`);
  await recordHistory(tx, {
    entity: "voucher", entityId: id, action: "approved", actor,
    after: { voucherNumber: voucher.voucher_number, amount: Number(voucher.amount), lines },
  });
  return voucher;
}

/** 승인 전표를 반대 전표로 취소한다. 원전표는 그대로 남고 취소 표시만 붙는다. */
export async function reverseVoucher(
  tx: any,
  id: number,
  input: { date: string; reason: string },
  actor: LedgerActor,
  approverRef: string,
): Promise<{ reversalId: number; voucherNumber: string }> {
  const voucher = await lockVoucher(tx, id);
  if (voucher.status !== "approved") throw new LedgerError("승인된 전표만 취소할 수 있습니다.");
  if (voucher.reversed_by_id) throw new LedgerError("이미 취소된 전표입니다.");
  if (voucher.voucher_type === "reversal") throw new LedgerError("반대 전표는 다시 취소할 수 없습니다.");

  const period = await periodProblem(tx, input.date);
  if (period) throw new LedgerError(period);

  const lines = await loadLines(tx, id);
  const yyyymm = input.date.slice(0, 7).replace("-", "");
  const voucherNumber = await nextVoucherNumber(tx, yyyymm);
  const created = rowsOf(await tx.execute(sql`
    INSERT INTO vouchers (
      voucher_number, voucher_date, fiscal_year, account_code, account_name, description, payee_name,
      amount, evidence_type, is_template, status, created_by, voucher_type, reversal_of_id,
      submitted_at, created_at, updated_at
    ) VALUES (
      ${voucherNumber}, ${input.date}, ${Number(input.date.slice(0, 4))},
      ${voucher.account_code}, ${voucher.account_name}, ${`[취소] ${voucher.voucher_number} ${voucher.description}`},
      ${voucher.payee_name}, ${Number(voucher.amount)}, 'none', FALSE, 'submitted', ${actor.name}, 'reversal', ${id},
      NOW(), NOW(), NOW()
    ) RETURNING id`))[0];
  const reversalId = Number(created.id);

  await saveLines(tx, reversalId, lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })));
  await tx.execute(sql`
    UPDATE vouchers
       SET status = 'approved', approved_by = ${approverRef}, approved_at = NOW(), updated_at = NOW()
     WHERE id = ${reversalId}`);
  await tx.execute(sql`UPDATE vouchers SET reversed_by_id = ${reversalId}, updated_at = NOW() WHERE id = ${id}`);

  await recordHistory(tx, {
    entity: "voucher", entityId: id, action: "reversed", actor, reason: input.reason,
    after: { reversalId, voucherNumber },
  });
  await recordHistory(tx, {
    entity: "voucher", entityId: reversalId, action: "approved", actor, reason: input.reason,
    after: { reversalOf: id, amount: Number(voucher.amount) },
  });
  return { reversalId, voucherNumber };
}

/** 인증 결과에서 이력·전표에 남길 작업자 정보를 만든다. */
export function ledgerActor(auth: any): LedgerActor {
  const member = auth?.ctx?.member;
  return {
    id: Number(auth?.ctx?.admin?.uid) || null,
    name: String(member?.name || member?.email || auth?.ctx?.admin?.uid || "관리자").slice(0, 100),
  };
}

/** 반려. 승인 대기 상태만 가능하고 이력을 남긴다. */
export async function rejectVoucher(
  tx: any,
  id: number,
  reason: string,
  actor: LedgerActor,
  approverRef: string,
): Promise<any> {
  const voucher = await lockVoucher(tx, id);
  if (voucher.status !== "submitted") {
    throw new LedgerError(`승인 대기 상태에서만 반려할 수 있습니다 (현재: ${voucher.status})`);
  }
  await tx.execute(sql`
    UPDATE vouchers
       SET status = 'rejected', approved_by = ${approverRef}, approved_at = NOW(),
           rejection_reason = ${reason}, updated_at = NOW()
     WHERE id = ${id}`);
  await recordHistory(tx, { entity: "voucher", entityId: id, action: "rejected", actor, reason });
  return voucher;
}

/** 계정과목 추가·수정 때 분류에서 정해지는 장부 속성 */
export const ACCOUNT_CATEGORIES = [
  "personnel", "program", "admin_ops", "fundraising", "income",
  "asset", "liability", "net_asset", "non_operating",
];

export function accountDefaults(category: string) {
  const expense = (nature: string | null, fn: string | null) => ({
    kind: "expense", normalSide: "debit", statementLine: "business_expense", nature, defaultFunction: fn,
  });
  switch (category) {
    case "income": return { kind: "revenue", normalSide: "credit", statementLine: "business_revenue", nature: null, defaultFunction: null };
    case "personnel": return expense("personnel", null);
    case "program": return expense("other", "service");
    case "admin_ops": return expense("other", "admin");
    case "fundraising": return expense("other", "fundraising");
    case "non_operating": return { kind: "expense", normalSide: "debit", statementLine: "non_operating_expense", nature: null, defaultFunction: null };
    case "asset": return { kind: "asset", normalSide: "debit", statementLine: "current_asset", nature: null, defaultFunction: null };
    case "liability": return { kind: "liability", normalSide: "credit", statementLine: "current_liability", nature: null, defaultFunction: null };
    case "net_asset": return { kind: "net_asset", normalSide: "credit", statementLine: "ordinary_net_asset", nature: null, defaultFunction: null };
    default: return null;
  }
}

/** 라우트 공통 오류 응답. LedgerError는 안내 그대로, 그 외는 step·detail로 돌려준다. */
export function ledgerErrorBody(step: string, fallback: string, err: any): { status: number; body: Record<string, unknown> } {
  if (err instanceof LedgerError) {
    return { status: err.status, body: { ok: false, error: err.message, missing: err.missing, step } };
  }
  const message = String(err?.message || err);
  const guardNotice = /승인된 전표|차변과 대변|전표 금액과|장부 기간 밖|결산이 끝난|마감된 기간|반복 전표 틀/.exec(message);
  return {
    status: guardNotice ? 422 : 500,
    body: {
      ok: false,
      error: guardNotice ? message.slice(0, 200) : fallback,
      step,
      detail: message.slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    },
  };
}
