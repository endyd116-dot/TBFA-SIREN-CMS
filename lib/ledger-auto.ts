// lib/ledger-auto.ts — 후원·수입·지출·급여·정산을 전표로 옮기는 자동 전표 (2026-11-06)
//
// 설계: docs/active/2026-11-06-ledger-flow-design.md
// 후원 기록 경로가 45곳이 넘어 결제 코드에 끼워 넣지 않고 원천 표를 훑는다.
// 같은 출처는 전표를 두 번 만들지 않고, 운영자가 취소한 자동 전표는 다시 만들지 않는다.
// 태그가 부족한 전표는 승인하지 않고 작성중으로 남긴다.
// 연결 1개 환경이라 트랜잭션 안에서는 tx만 쓴다.
import { sql } from "drizzle-orm";
import { db } from "../db";
import { todayKST } from "./kst";
import { nextVoucherNumber } from "./voucher-number";
import { loadFiscalYears, type FiscalYear } from "./ledger-report";
import {
  type LedgerAccount, type LedgerActor, type LedgerLine,
  headerFromLines, lineProblems, loadAccounts, recordHistory, reverseVoucher, splitByRatio, storedLine, ymd,
} from "./ledger-post";

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];

export const SYSTEM_ACTOR: LedgerActor = { id: null, name: "자동 전표" };
const SYSTEM_REF = "system";
const DEFAULT_LIMIT = 300;

export type SourceType =
  | "donation" | "revenue" | "revenue_refund" | "expense" | "expense_refund" | "payroll" | "settlement";

export const SOURCE_LABEL: Record<SourceType, string> = {
  donation: "후원금",
  revenue: "기타 수입",
  revenue_refund: "수입 환불",
  expense: "지출",
  expense_refund: "지출 환불",
  payroll: "급여",
  settlement: "정산 입금",
};

interface Entry {
  sourceType: SourceType;
  sourceId: string;
  date: string;
  voucherType: "income" | "expense" | "transfer";
  description: string;
  payeeName: string | null;
  lines: LedgerLine[];
  evidenceType?: string;
  expenseId?: number | null;
  bankTxnId?: number | null;
  /** false면 태그가 갖춰져도 작성중으로 남긴다 */
  forceDraft?: boolean;
}

interface Context {
  fiscalYears: FiscalYear[];
  start: string;
  roles: Map<string, string>;
  funds: Map<string, number>;
  segments: Map<number, string>;
}

const line = (accountCode: string, debit: number, credit: number, tags: Partial<LedgerLine> = {}): LedgerLine => ({
  accountCode, debit, credit,
  functionCode: tags.functionCode ?? null,
  programId: tags.programId ?? null,
  fundId: tags.fundId ?? null,
  memo: tags.memo ?? null,
});

/** 저장 시각을 한국 날짜로 바꾼다. 컬럼은 시간대 없는 UTC라 두 단계 변환이 필요하다. */
const kstDate = (column: any) => sql`to_char((${column} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`;

/** 자동 전표가 없는 출처만 고르는 조건. 시스템이 취소한 전표는 없는 것으로 친다.
 *  idExpr은 바깥 조회의 별칭을 쓴다. 안쪽 별칭 v·reversal과 겹치면 조건이 조용히 틀어진다. */
const noVoucher = (type: SourceType, idExpr: any) => sql`NOT EXISTS (
  SELECT 1 FROM vouchers v
    LEFT JOIN vouchers reversal ON reversal.id = v.reversed_by_id
   WHERE v.source_type = ${type} AND v.source_id = ${idExpr}
     AND (v.reversed_by_id IS NULL OR reversal.created_by <> ${SYSTEM_ACTOR.name}))`;

async function loadContext(): Promise<Context | null> {
  const fiscalYears = await loadFiscalYears();
  if (!fiscalYears.length) return null;
  const roles = new Map<string, string>();
  for (const r of rowsOf(await db.execute(sql`
    SELECT code, system_role FROM account_codes WHERE system_role IS NOT NULL`))) roles.set(r.system_role, r.code);
  const funds = new Map<string, number>();
  for (const r of rowsOf(await db.execute(sql`SELECT id, code FROM ledger_funds`))) funds.set(r.code, Number(r.id));
  const segments = new Map<number, string>();
  for (const r of rowsOf(await db.execute(sql`SELECT id, segment FROM ledger_programs`))) segments.set(Number(r.id), r.segment);
  return { fiscalYears, start: fiscalYears[0].startDate, roles, funds, segments };
}

function periodState(ctx: Context, date: string): "ok" | "before" | "closed" | "none" {
  if (date < ctx.start) return "before";
  const fy = ctx.fiscalYears.find((f) => date >= f.startDate && date <= f.endDate);
  if (!fy) return "none";
  if (fy.status !== "open" || (fy.closedThrough && date <= fy.closedThrough)) return "closed";
  return "ok";
}

const fundFor = (ctx: Context, account: LedgerAccount | undefined): number | null => {
  const line_ = account?.statementLine ?? "";
  if (line_.startsWith("donation_")) return ctx.funds.get("F02") ?? null;
  if (line_ === "grant") return ctx.funds.get("F04") ?? null;
  if (line_ === "membership_fee") return ctx.funds.get("F01") ?? null;
  return ctx.funds.get("F05") ?? null;
};

/* ── 후원금 ── */
async function collectDonations(ctx: Context, limit: number): Promise<Entry[]> {
  const paid = sql`COALESCE(d.paid_at, d.hyosung_paid_date, d.created_at)`;
  const rows = rowsOf(await db.execute(sql`
    SELECT d.id, d.donor_name, d.amount, d.pay_method, ${kstDate(paid)} AS paid_on
      FROM donations d
     WHERE d.status = 'completed' AND d.amount > 0
       AND ${paid} >= (${ctx.start}::date - INTERVAL '1 day')
       AND ${noVoucher("donation", sql`d.id::text`)}
     ORDER BY d.id
     LIMIT ${limit}`));
  const cash = ctx.roles.get("cash_default")!;
  const receivable = ctx.roles.get("settlement_receivable")!;
  const fundId = ctx.funds.get("F02") ?? null;
  return rows.map((r: any) => {
    const amount = Number(r.amount);
    const direct = r.pay_method === "bank";
    return {
      sourceType: "donation" as const, sourceId: String(r.id), date: r.paid_on, voucherType: "income" as const,
      description: `후원금 ${r.donor_name || ""}`.trim(), payeeName: r.donor_name || null,
      evidenceType: "transfer_confirm",
      lines: [line(direct ? cash : receivable, amount, 0), line("4011", 0, amount, { fundId })],
    };
  });
}

/* ── 기타 수입 ── */
async function collectRevenues(ctx: Context, limit: number, accounts: Map<string, LedgerAccount>): Promise<Entry[]> {
  const rows = rowsOf(await db.execute(sql`
    SELECT r.id, r.recognized_at, r.amount, r.payer_name, r.description, c.account_code, c.name AS category_name
      FROM other_revenues r
      JOIN revenue_categories c ON c.id = r.category_id
     WHERE r.status = 'approved' AND r.amount > 0 AND r.recognized_at >= ${ctx.start}
       AND ${noVoucher("revenue", sql`r.id::text`)}
     ORDER BY r.id
     LIMIT ${limit}`));
  const cash = ctx.roles.get("cash_default")!;
  const out: Entry[] = [];
  for (const r of rows) {
    const code = r.account_code || "4022";
    if (!accounts.has(code)) for (const [k, v] of await loadAccounts(db, [code])) accounts.set(k, v);
    const amount = Number(r.amount);
    out.push({
      sourceType: "revenue", sourceId: String(r.id), date: ymd(r.recognized_at), voucherType: "income",
      description: r.description || r.category_name, payeeName: r.payer_name || null,
      lines: [line(cash, amount, 0), line(code, 0, amount, { fundId: fundFor(ctx, accounts.get(code)) })],
    });
  }
  return out;
}

/* ── 지출 ── */
const CATEGORY_ACCOUNT: Record<string, string> = {
  personnel: "5011", program: "5021", admin_ops: "5045", fundraising: "5041",
};

async function collectExpenses(ctx: Context, limit: number, accounts: Map<string, LedgerAccount>): Promise<Entry[]> {
  const rows = rowsOf(await db.execute(sql`
    SELECT e.id, e.occurred_at, e.amount, e.payee_name, e.description, e.account_code, e.function_code,
           e.program_id, e.fund_id, e.bank_txn_id, e.pay_account_code, e.budget_account_id, ec.code AS category_code,
           (SELECT m.account_code FROM budget_account_code_map m
             WHERE m.budget_account_id = e.budget_account_id ORDER BY m.id LIMIT 1) AS mapped_code
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.id = e.category_id
     WHERE e.status = 'approved' AND e.amount > 0 AND e.occurred_at >= ${ctx.start}
       AND ${noVoucher("expense", sql`e.id::text`)}
     ORDER BY e.id
     LIMIT ${limit}`));
  const out: Entry[] = [];
  for (const r of rows) {
    const code = r.account_code || r.mapped_code || CATEGORY_ACCOUNT[r.category_code] || "5045";
    if (!accounts.has(code)) for (const [k, v] of await loadAccounts(db, [code])) accounts.set(k, v);
    const account = accounts.get(code);
    const amount = Number(r.amount);
    const pay = r.pay_account_code || ctx.roles.get("cash_default")!;
    out.push({
      sourceType: "expense", sourceId: String(r.id), date: ymd(r.occurred_at), voucherType: "expense",
      description: r.description || "지출", payeeName: r.payee_name || null,
      expenseId: Number(r.id), bankTxnId: r.bank_txn_id == null ? null : Number(r.bank_txn_id),
      evidenceType: "transfer_confirm",
      lines: [
        line(code, amount, 0, {
          functionCode: r.function_code || account?.defaultFunction || null,
          programId: r.program_id == null ? null : Number(r.program_id),
          fundId: r.fund_id == null ? null : Number(r.fund_id),
        }),
        line(pay, 0, amount),
      ],
    });
  }
  return out;
}

/* ── 환불: 누적 환불액과 이미 전표로 만든 금액의 차이만 만든다 ── */
async function collectRefunds(ctx: Context): Promise<Entry[]> {
  const out: Entry[] = [];
  const cash = ctx.roles.get("cash_default")!;

  const refunds = async (type: "expense" | "revenue", table: any, refundType: SourceType) => {
    const rows = rowsOf(await db.execute(sql`
      SELECT t.id, t.refund_amount, ${kstDate(sql`(t.updated_at AT TIME ZONE 'UTC')`)} AS refunded_on, v.id AS voucher_id,
             COALESCE((SELECT SUM(x.amount) FROM vouchers x
                        WHERE x.source_type = ${refundType} AND x.source_id LIKE t.id::text || ':%'
                          AND x.reversed_by_id IS NULL), 0)::bigint AS posted
        FROM ${table} t
        JOIN vouchers v ON v.source_type = ${type} AND v.source_id = t.id::text
                       AND v.status = 'approved' AND v.reversed_by_id IS NULL
       WHERE t.refund_amount > 0`));
    for (const r of rows) {
      const cumulative = Number(r.refund_amount);
      const delta = cumulative - Number(r.posted);
      if (delta <= 0) continue;
      const first = rowsOf(await db.execute(sql`
        SELECT l.account_code, l.function_code, l.program_id, l.fund_id
          FROM voucher_lines l JOIN account_codes a ON a.code = l.account_code
         WHERE l.voucher_id = ${Number(r.voucher_id)} AND a.kind IN ('expense','revenue')
         ORDER BY l.line_no LIMIT 1`))[0];
      if (!first) continue;
      const tags = {
        functionCode: first.function_code,
        programId: first.program_id == null ? null : Number(first.program_id),
        fundId: first.fund_id == null ? null : Number(first.fund_id),
      };
      out.push({
        sourceType: refundType, sourceId: `${r.id}:${cumulative}`, date: r.refunded_on,
        voucherType: type === "expense" ? "income" : "expense",
        description: `${type === "expense" ? "지출" : "수입"} 환불 #${r.id}`, payeeName: null,
        lines: type === "expense"
          ? [line(cash, delta, 0), line(first.account_code, 0, delta, tags)]
          : [line(first.account_code, delta, 0, tags), line(cash, 0, delta)],
      });
    }
  };

  await refunds("expense", sql`expenses`, "expense_refund");
  await refunds("revenue", sql`other_revenues`, "revenue_refund");
  return out;
}

/** 사단법인 고유번호. 법인화 전 임의단체 번호(118-82-71215)와 구분한다 */
export const ORG_BIZ_NO = "3818200754";

/* ── 급여: 지급 확정분. 직원별 전표 ──
   급여 관리는 여러 사업자의 직원을 함께 다룬다. 사단법인 장부에는 사단법인 소속 급여만 넣는다.
   완료된 근로계약이 있으면 그 사업자의 번호로 판단하고, 없으면 인건비 배부를 저장한 직원만 넣는다. */
async function collectPayroll(ctx: Context, limit: number): Promise<Entry[]> {
  const rows = rowsOf(await db.execute(sql`
    SELECT p.id, p.member_uid, p.pay_year, p.pay_month, p.gross_pay, p.total_deduction, p.net_pay,
           p.performance_bonus, p.perfect_bonus, ${kstDate(sql`p.paid_at`)} AS paid_on,
           m.name AS member_name, s.function_code, s.program_id, s.fund_id, r.lines AS rule_lines
      FROM payroll_slips p
      LEFT JOIN members m ON m.id::text = p.member_uid
      LEFT JOIN ledger_staff_allocations s ON s.member_id::text = p.member_uid
      LEFT JOIN ledger_allocation_rules r ON r.id = s.rule_id AND r.is_active = TRUE
      LEFT JOIN LATERAL (
        SELECT regexp_replace(COALESCE(e.biz_no, ''), '[^0-9]', '', 'g') AS biz_no FROM employment_contracts c
          JOIN contract_business_entities e ON e.id = c.entity_id
         WHERE c.member_id::text = p.member_uid AND c.status = 'completed'
         ORDER BY c.id DESC LIMIT 1) employer ON TRUE
     WHERE p.status = 'PAID' AND p.paid_at IS NOT NULL
       AND p.paid_at >= (${ctx.start}::date - INTERVAL '1 day')
       AND (CASE WHEN employer.biz_no IS NOT NULL THEN employer.biz_no = ${ORG_BIZ_NO} ELSE s.member_id IS NOT NULL END)
       AND ${noVoucher("payroll", sql`p.id::text`)}
     ORDER BY p.id
     LIMIT ${limit}`));
  const cash = ctx.roles.get("cash_default")!;
  const withholding = ctx.roles.get("withholding")!;
  const out: Entry[] = [];
  for (const r of rows) {
    const gross = Math.round(Number(r.gross_pay));
    if (gross <= 0) continue;
    const deduction = Math.round(Number(r.total_deduction));
    const net = gross - deduction;
    const bonus = Math.min(gross, Math.round(Number(r.performance_bonus) + Number(r.perfect_bonus)));
    const tags = {
      functionCode: r.function_code || "admin",
      programId: r.program_id == null ? null : Number(r.program_id),
      fundId: r.fund_id == null ? (ctx.funds.get("F02") ?? null) : Number(r.fund_id),
    };
    const rule = Array.isArray(r.rule_lines) ? r.rule_lines : [];
    const cost = (code: string, amount: number): LedgerLine[] => {
      if (amount <= 0) return [];
      if (!rule.length) return [line(code, amount, 0, tags)];
      return splitByRatio(amount, rule as { ratio: number; functionCode: string; programId: number | null; fundId: number | null }[])
        .map((p) => line(code, p.amount, 0, {
          functionCode: p.functionCode, programId: p.programId ?? null, fundId: p.fundId ?? tags.fundId,
        }));
    };
    const lines: LedgerLine[] = [...cost("5011", gross - bonus), ...cost("5015", bonus)];
    if (deduction > 0) lines.push(line(withholding, 0, deduction));
    if (net > 0) lines.push(line(cash, 0, net));
    out.push({
      sourceType: "payroll", sourceId: String(r.id), date: r.paid_on, voucherType: "expense",
      description: `${r.pay_year}년 ${r.pay_month}월 급여 ${r.member_name || ""}`.trim(), payeeName: r.member_name || null,
      /* 명세의 실수령액과 1원 넘게 다르면 사람이 확인하도록 작성중으로 둔다 */
      forceDraft: Math.abs(net - Number(r.net_pay)) > 1,
      lines,
    });
  }
  return out;
}

/* ── 카드·CMS 정산 입금 ── */
async function collectSettlements(ctx: Context, limit: number): Promise<Entry[]> {
  const rows = rowsOf(await db.execute(sql`
    SELECT b.id, b.txn_date, b.amount, b.description, b.counterpart_name, i.account_code, i.bank_name
      FROM bank_transactions b
      LEFT JOIN bank_imports i ON i.id = b.import_id
     WHERE b.match_type = 'donation_batch' AND b.txn_type = 'credit' AND b.txn_date >= ${ctx.start}
       AND ${noVoucher("settlement", sql`b.id::text`)}
     ORDER BY b.id
     LIMIT ${limit}`));
  const receivable = ctx.roles.get("settlement_receivable")!;
  return rows.map((r: any) => {
    const amount = Math.abs(Number(r.amount));
    return {
      sourceType: "settlement" as const, sourceId: String(r.id), date: ymd(r.txn_date), voucherType: "transfer" as const,
      description: `정산 입금 ${r.counterpart_name || r.description || ""}`.trim(), payeeName: r.counterpart_name || null,
      bankTxnId: Number(r.id), evidenceType: "transfer_confirm",
      lines: [line(r.account_code || ctx.roles.get("cash_default")!, amount, 0), line(receivable, 0, amount)],
    };
  });
}

/* ── 원천이 취소된 전표 ── */
async function collectCancelled(): Promise<{ id: number; status: string; on: string; voucherDate: string; label: string }[]> {
  const query = (type: SourceType, table: any, valid: any, updated: any, label: string) => sql`
    SELECT v.id, v.status, v.voucher_date, ${kstDate(updated)} AS changed_on, ${label}::text AS label
      FROM vouchers v
      JOIN ${table} t ON v.source_type = ${type} AND v.source_id = t.id::text
     WHERE v.reversed_by_id IS NULL AND v.voucher_type <> 'reversal' AND NOT (${valid})`;
  const parts = [
    query("donation", sql`donations`, sql`t.status = 'completed'`, sql`t.updated_at`, "후원 환불·취소"),
    query("revenue", sql`other_revenues`, sql`t.status = 'approved'`, sql`(t.updated_at AT TIME ZONE 'UTC')`, "수입 취소"),
    query("expense", sql`expenses`, sql`t.status = 'approved'`, sql`(t.updated_at AT TIME ZONE 'UTC')`, "지출 취소"),
    query("payroll", sql`payroll_slips`, sql`t.status = 'PAID'`, sql`t.updated_at`, "급여 지급 취소"),
  ];
  const out: { id: number; status: string; on: string; voucherDate: string; label: string }[] = [];
  for (const q of parts) {
    for (const r of rowsOf(await db.execute(q))) {
      out.push({ id: Number(r.id), status: r.status, on: r.changed_on, voucherDate: ymd(r.voucher_date), label: r.label });
    }
  }
  return out;
}

async function collect(ctx: Context, limit: number, only?: SourceType[]) {
  const accounts = await loadAccounts(db, ["4011", "4022"]);
  const wants = (t: SourceType) => !only || only.includes(t);
  const entries: Entry[] = [
    ...(wants("donation") ? await collectDonations(ctx, limit) : []),
    ...(wants("revenue") ? await collectRevenues(ctx, limit, accounts) : []),
    ...(wants("expense") ? await collectExpenses(ctx, limit, accounts) : []),
    ...(wants("expense_refund") ? await collectRefunds(ctx) : []),
    ...(wants("payroll") ? await collectPayroll(ctx, limit) : []),
    ...(wants("settlement") ? await collectSettlements(ctx, limit) : []),
  ];
  const codes = entries.flatMap((e) => e.lines.map((l) => l.accountCode)).filter((c) => !accounts.has(c));
  for (const [k, v] of await loadAccounts(db, codes)) accounts.set(k, v);
  return { entries, accounts };
}

/** 전표를 한 달 단위로 묶어 저장한다. 번호는 잠금 안에서 이어서 발급한다. */
async function writeMonth(ctx: Context, yyyymm: string, entries: Entry[], accounts: Map<string, LedgerAccount>) {
  return db.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ledger-sync'))`);
    const first = await nextVoucherNumber(tx, yyyymm);
    let seq = Number(first.split("-")[1]);

    const tuples = entries.map((e) => {
      const header = headerFromLines(e.lines, accounts);
      const number = `${yyyymm}-${String(seq).padStart(3, "0")}`;
      seq += 1;
      const fiscalYear = Number(e.date.slice(0, 4));
      return sql`(${number}, ${e.date}, ${fiscalYear}, ${header.accountCode}, ${header.accountName},
        ${e.description.slice(0, 500)}, ${e.payeeName ? e.payeeName.slice(0, 200) : null}, ${header.amount},
        ${e.evidenceType ?? "none"}, ${e.expenseId ?? null}, ${e.bankTxnId ?? null}, FALSE, 'draft',
        ${SYSTEM_ACTOR.name}, ${e.voucherType}, ${e.sourceType}, ${e.sourceId}, NOW(), NOW())`;
    });
    const inserted = rowsOf(await tx.execute(sql`
      INSERT INTO vouchers (
        voucher_number, voucher_date, fiscal_year, account_code, account_name, description, payee_name, amount,
        evidence_type, expense_id, bank_txn_id, is_template, status, created_by, voucher_type, source_type, source_id,
        created_at, updated_at
      ) VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT (source_type, source_id) WHERE source_type IS NOT NULL AND reversed_by_id IS NULL
      DO NOTHING
      RETURNING id, source_type, source_id`));

    const byKey = new Map(entries.map((e) => [`${e.sourceType}:${e.sourceId}`, e]));
    const lineTuples: any[] = [];
    const postIds: number[] = [];
    const counts = { posted: 0, drafts: 0 };
    for (const row of inserted) {
      const entry = byKey.get(`${row.source_type}:${row.source_id}`);
      if (!entry) continue;
      const voucherId = Number(row.id);
      entry.lines.forEach((l, i) => {
        const s = storedLine(l, accounts.get(l.accountCode), ctx.segments);
        lineTuples.push(sql`(${voucherId}, ${i + 1}, ${l.accountCode}, ${l.debit}, ${l.credit},
          ${s.functionCode}, ${s.programId}, ${s.fundId}, ${s.segment}, ${l.memo})`);
      });
      const ready = !entry.forceDraft && lineProblems(entry.lines, accounts, true).length === 0;
      if (ready) { postIds.push(voucherId); counts.posted += 1; } else { counts.drafts += 1; }
    }
    if (lineTuples.length) {
      await tx.execute(sql`
        INSERT INTO voucher_lines
          (voucher_id, line_no, account_code, debit, credit, function_code, program_id, fund_id, segment, memo)
        VALUES ${sql.join(lineTuples, sql`, `)}`);
    }
    if (postIds.length) {
      await tx.execute(sql`
        UPDATE vouchers
           SET status = 'approved', approved_by = ${SYSTEM_REF}, approved_at = NOW(), submitted_at = NOW(), updated_at = NOW()
         WHERE id IN (${sql.join(postIds.map((id) => sql`${id}`), sql`, `)})`);
    }
    return counts;
  });
}

export interface SyncResult {
  posted: number;
  drafts: number;
  reversed: number;
  deletedDrafts: number;
  blocked: number;
  bySource: Record<string, number>;
}

/** 자동 전표를 만든다. 실패해도 원천 데이터에는 영향이 없다. */
export async function syncLedger(opts: { limit?: number; only?: SourceType[] } = {}): Promise<SyncResult> {
  const result: SyncResult = { posted: 0, drafts: 0, reversed: 0, deletedDrafts: 0, blocked: 0, bySource: {} };
  const ctx = await loadContext();
  if (!ctx) return result;
  const today = todayKST();

  /* 원천이 취소된 전표부터 정리 */
  if (!opts.only) {
    for (const c of await collectCancelled()) {
      if (c.status === "approved") {
        /* 반대 전표는 원전표보다 앞설 수 없다. 그날이 마감됐으면 오늘로 옮긴다 */
        const wanted = c.on > c.voucherDate ? c.on : c.voucherDate;
        const date = periodState(ctx, wanted) === "ok" ? wanted : today;
        if (periodState(ctx, date) !== "ok") { result.blocked += 1; continue; }
        await db.transaction((tx: any) =>
          reverseVoucher(tx, c.id, { date, reason: c.label }, SYSTEM_ACTOR, SYSTEM_REF));
        result.reversed += 1;
      } else if (c.status === "draft" || c.status === "rejected") {
        await db.transaction(async (tx: any) => {
          await tx.execute(sql`DELETE FROM vouchers WHERE id = ${c.id}`);
          await recordHistory(tx, { entity: "voucher", entityId: c.id, action: "deleted", actor: SYSTEM_ACTOR, reason: c.label });
        });
        result.deletedDrafts += 1;
      }
    }
  }

  const { entries, accounts } = await collect(ctx, opts.limit ?? DEFAULT_LIMIT, opts.only);
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const state = periodState(ctx, e.date);
    if (state === "before") continue;
    if (state !== "ok") { result.blocked += 1; continue; }
    const key = e.date.slice(0, 7).replace("-", "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
    result.bySource[e.sourceType] = (result.bySource[e.sourceType] ?? 0) + 1;
  }

  for (const [yyyymm, list] of groups) {
    const counts = await writeMonth(ctx, yyyymm, list, accounts);
    result.posted += counts.posted;
    result.drafts += counts.drafts;
  }

  if (result.posted || result.drafts || result.reversed || result.deletedDrafts) {
    const dates = entries.map((e) => e.date).sort();
    await recordHistory(db, {
      entity: "ledger_sync", entityId: today, action: "auto_posted", actor: SYSTEM_ACTOR,
      after: { ...result, date: dates[0] ?? today },
    });
  }
  return result;
}

/** 아직 전표가 되지 않은 건수. 화면 표시와 월 마감 점검용이며 아무것도 쓰지 않는다. */
export async function pendingStatus() {
  const ctx = await loadContext();
  const empty = { total: 0, blocked: 0, bySource: {} as Record<string, number> };
  if (!ctx) return empty;
  const { entries } = await collect(ctx, 1000);
  const status = { ...empty, bySource: {} as Record<string, number> };
  for (const e of entries) {
    const state = periodState(ctx, e.date);
    if (state === "before") continue;
    if (state !== "ok") { status.blocked += 1; continue; }
    status.total += 1;
    status.bySource[e.sourceType] = (status.bySource[e.sourceType] ?? 0) + 1;
  }
  return status;
}
