// lib/payroll-approval.ts — 급여 지급 결재 (2026-11-07)
//
// 급여 대장을 지출결의서 한 장으로 올리고, 승인 뒤 지급 확인 때 급여 명세를 한꺼번에 지급 완료로 바꾼다.
// 장부에는 급여 전표만 들어간다. 이 문서는 지출을 따로 만들지 않으므로 인건비가 두 번 잡히지 않는다.
// 대상은 사단법인 소속 급여뿐이다. 판정은 자동 전표(lib/ledger-auto.ts)와 같은 조각을 쓴다.
// 직원별 금액은 급여 관리와 같이 이사장만 본다. 다른 열람자에게는 인원과 합계만 보인다.
// 예산은 급여 전표가 잡히는 과목(기본급·상여금)별로 나눠 예약한다.
// 연결 1개 환경이라 트랜잭션 안에서는 인자로 받은 tx만 쓴다.
import { sql } from "drizzle-orm";
import { db } from "../db";
import { yearKST } from "./kst";
import { LedgerError } from "./ledger-post";
import { loadAccountToMok, type QueryRunner } from "./finance-budget-report";
import { budgetPosition, lockBudget, recordBudgetLedger, type BudgetPosition, type BudgetTxnType } from "./budget-ledger";

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const won = (n: number) => Number(n || 0).toLocaleString("ko-KR");
const truthy = (v: any) => v === true || v === "t";

/** 사단법인 고유번호. 법인화 전 임의단체 번호(118-82-71215)와 구분한다 */
export const ORG_BIZ_NO = "3818200754";

/** 급여 전표가 쓰는 계정. 기본급 몫은 급여, 성과·만근 상여는 상여금 */
const PAY_ACCOUNT = "5011";
const BONUS_ACCOUNT = "5015";

/** 사단법인 소속 판정에 쓰는 조인. 별칭 s(인건비 배부)와 employer(완료 계약의 사업자 번호)를 만든다 */
export const orgPayrollJoins = (memberUid: any) => sql`
  LEFT JOIN ledger_staff_allocations s ON s.member_id::text = ${memberUid}
  LEFT JOIN LATERAL (
    SELECT regexp_replace(COALESCE(e.biz_no, ''), '[^0-9]', '', 'g') AS biz_no FROM employment_contracts c
      JOIN contract_business_entities e ON e.id = c.entity_id
     WHERE c.member_id::text = ${memberUid} AND c.status = 'completed'
     ORDER BY c.id DESC LIMIT 1) employer ON TRUE`;

/** 완료된 근로계약이 있으면 그 사업자의 번호로 판단하고, 없으면 인건비 배부를 저장한 직원만 사단법인 소속으로 본다 */
export const ORG_PAYROLL = sql`(CASE WHEN employer.biz_no IS NOT NULL THEN employer.biz_no = ${ORG_BIZ_NO} ELSE s.member_id IS NOT NULL END)`;

export interface PayrollRow {
  slipId: number;
  memberUid: string;
  name: string;
  position: string | null;
  gross: number;
  deduction: number;
  net: number;
  /** 성과·만근 상여. 지급총액 안에 들어 있다 */
  bonus: number;
  /** 완료된 근로계약이 있는가. 없으면 급여 근거를 따로 붙여야 한다 */
  contract: boolean;
}

export interface PayrollBudgetPart {
  budgetAccountId: number | null;
  accountCode: string;
  label: string;
  amount: number;
}

export interface PayrollForm {
  year: number;
  month: number;
  slipIds: number[];
  count: number;
  gross: number;
  deduction: number;
  net: number;
  noContract: number;
  rows: PayrollRow[];
  budget: PayrollBudgetPart[];
  refreshedAt: string;
}

export const payrollOf = (formData: any): PayrollForm | null =>
  formData && typeof formData === "object" && formData.payroll && Array.isArray(formData.payroll.slipIds)
    ? (formData.payroll as PayrollForm) : null;

/** 급여 지급 결재인가. 표식은 서버만 쓴다(화면이 보낸 값은 저장 때 버린다) */
export const isPayrollDoc = (doc: any): boolean => doc?.doc_type === "expense" && !!payrollOf(doc?.form_data);

/** 직원별 금액은 이사장만 본다. 나머지 열람자에게는 인원과 합계만 남긴다 */
export function maskPayroll(formData: any, full: boolean): any {
  const p = payrollOf(formData);
  if (!p || full) return formData ?? {};
  return { ...formData, payroll: { ...p, rows: [], masked: true } };
}

export interface SlipClaim {
  docId: number;
  docNo: string | null;
  status: string;
  paymentStatus: string | null;
  /** 결재가 진행 중이거나 끝난 문서에 묶여 있어 급여 관리에서 고칠 수 없다 */
  locked: boolean;
  label: string;
}

function claimLabel(status: string, paymentStatus: string | null): string {
  if (status === "pending") return "결재 진행 중";
  if (status === "approved") return paymentStatus === "paid" ? "결재 지급 완료" : "결재 승인, 지급 확인 대기";
  if (status === "rejected") return "결재 반려";
  if (status === "recalled") return "결재 회수";
  return "결재 작성 중";
}

/** 급여 명세가 묶인 결재 문서. 취소·삭제된 문서는 묶음에서 빠진다. */
export async function slipClaims(exec: QueryRunner, opts: { slipIds?: number[]; excludeDocId?: number } = {}): Promise<Map<number, SlipClaim>> {
  const out = new Map<number, SlipClaim>();
  const ids = (opts.slipIds ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (opts.slipIds && !ids.length) return out;
  const only = ids.length ? sql`AND e.value IN (${sql.join(ids.map((i) => sql`${String(i)}`), sql`, `)})` : sql``;
  const rows = rowsOf(await exec.execute(sql`
    SELECT r.id, r.doc_no, r.status, r.payment_status, e.value AS slip_id
      FROM approval_requests r
     CROSS JOIN LATERAL jsonb_array_elements_text(
       CASE WHEN jsonb_typeof(r.form_data->'payroll'->'slipIds') = 'array'
            THEN r.form_data->'payroll'->'slipIds' ELSE '[]'::jsonb END) AS e(value)
     WHERE r.doc_type = 'expense' AND r.delete_status = 'none'
       AND r.status IN ('draft', 'pending', 'approved', 'rejected', 'recalled')
       AND r.id <> ${opts.excludeDocId ?? 0}
       ${only}
     ORDER BY r.id`));
  for (const r of rows) {
    const slipId = Number(r.slip_id);
    const locked = r.status === "pending" || r.status === "approved";
    const prev = out.get(slipId);
    if (prev?.locked && !locked) continue;
    out.set(slipId, {
      docId: Number(r.id), docNo: r.doc_no ?? null, status: r.status, paymentStatus: r.payment_status ?? null,
      locked, label: claimLabel(r.status, r.payment_status ?? null),
    });
  }
  return out;
}

/** 급여 관리 화면용. 명세가 사단법인 소속인지와 묶인 결재를 함께 돌려준다 */
export async function payrollMonthStatus(exec: QueryRunner, year: number, month: number): Promise<Map<number, { org: boolean; claim: SlipClaim | null }>> {
  const rows = rowsOf(await exec.execute(sql`
    SELECT p.id, ${ORG_PAYROLL} AS org
      FROM payroll_slips p
      ${orgPayrollJoins(sql`p.member_uid`)}
     WHERE p.pay_year = ${year} AND p.pay_month = ${month}`));
  const claims = await slipClaims(exec, { slipIds: rows.map((r: any) => Number(r.id)) });
  return new Map(rows.map((r: any) => [Number(r.id), { org: truthy(r.org), claim: claims.get(Number(r.id)) ?? null }]));
}

/** 명세 한 건의 상태. 급여 관리의 수정·보류·삭제·지급·재집계 앞에서 확인한다 */
export async function slipApprovalState(exec: QueryRunner, slipId: number): Promise<{ org: boolean; claim: SlipClaim | null }> {
  const r = rowsOf(await exec.execute(sql`
    SELECT ${ORG_PAYROLL} AS org
      FROM payroll_slips p
      ${orgPayrollJoins(sql`p.member_uid`)}
     WHERE p.id = ${slipId}`))[0];
  const claim = (await slipClaims(exec, { slipIds: [slipId] })).get(slipId) ?? null;
  return { org: truthy(r?.org), claim };
}

/** 묶인 명세를 고치려 할 때의 안내 문구 */
export const lockedNotice = (claim: SlipClaim) =>
  `${claim.label}인 급여입니다${claim.docNo ? ` (${claim.docNo})` : ""}. 고치려면 결재 문서를 먼저 회수하거나 취소해 주세요.`;

/** 급여 전표가 집계되는 예산 과목. 이 과목은 급여 지급 결재로만 집행한다 */
export async function payrollMoks(exec: QueryRunner): Promise<Set<number>> {
  const toMok = await loadAccountToMok(exec);
  const out = new Set<number>();
  for (const code of [PAY_ACCOUNT, BONUS_ACCOUNT]) {
    const mok = toMok(code, "personnel");
    if (mok != null) out.add(mok);
  }
  return out;
}

const STATUS_KO: Record<string, string> = { DRAFT: "초안", REVIEWED: "검토 완료", APPROVED: "승인됨", SENT: "발송됨", HOLD: "보류", PAID: "지급 완료" };

/** 그 달의 사단법인 소속 급여 가운데 결재에 올릴 수 있는 명세를 모은다 */
async function collectPayroll(exec: QueryRunner, year: number, month: number, excludeDocId: number): Promise<{ form: PayrollForm | null; skipped: string[]; orgCount: number }> {
  const slips = rowsOf(await exec.execute(sql`
    SELECT p.id, p.member_uid, p.status, p.gross_pay, p.total_deduction, p.performance_bonus, p.perfect_bonus,
           m.name AS member_name, m.position AS member_position, (employer.biz_no IS NOT NULL) AS has_contract
      FROM payroll_slips p
      LEFT JOIN members m ON m.id::text = p.member_uid
      ${orgPayrollJoins(sql`p.member_uid`)}
     WHERE p.pay_year = ${year} AND p.pay_month = ${month} AND ${ORG_PAYROLL}
     ORDER BY p.id`));
  const claims = await slipClaims(exec, { slipIds: slips.map((s: any) => Number(s.id)), excludeDocId });
  const rows: PayrollRow[] = [];
  const skipped: string[] = [];
  for (const s of slips) {
    const name = String(s.member_name ?? `직원 ${s.member_uid}`);
    const claim = claims.get(Number(s.id));
    const gross = Math.round(Number(s.gross_pay));
    if (s.status === "PAID") { skipped.push(`${name}: 이미 지급 완료`); continue; }
    if (s.status !== "APPROVED" && s.status !== "SENT") { skipped.push(`${name}: 급여 관리에서 승인 전 (${STATUS_KO[s.status] ?? s.status})`); continue; }
    if (claim) { skipped.push(`${name}: 다른 결재 문서에 들어 있음 (${claim.docNo ?? "임시저장"})`); continue; }
    if (!(gross > 0)) { skipped.push(`${name}: 지급액 없음`); continue; }
    const deduction = Math.round(Number(s.total_deduction));
    const bonus = Math.max(0, Math.min(gross, Math.round(Number(s.performance_bonus) + Number(s.perfect_bonus))));
    rows.push({
      slipId: Number(s.id), memberUid: String(s.member_uid), name, position: s.member_position ?? null,
      gross, deduction, net: gross - deduction, bonus, contract: truthy(s.has_contract),
    });
  }
  if (!rows.length) return { form: null, skipped, orgCount: slips.length };

  const sum = (read: (r: PayrollRow) => number) => rows.reduce((t, r) => t + read(r), 0);
  const gross = sum((r) => r.gross);
  const bonus = sum((r) => r.bonus);
  const toMok = await loadAccountToMok(exec);
  const parts = new Map<number | null, PayrollBudgetPart>();
  for (const [accountCode, amount] of [[PAY_ACCOUNT, gross - bonus], [BONUS_ACCOUNT, bonus]] as [string, number][]) {
    if (amount <= 0) continue;
    const mok = toMok(accountCode, "personnel");
    const prev = parts.get(mok);
    if (prev) prev.amount += amount;
    else parts.set(mok, { budgetAccountId: mok, accountCode, label: "예산 과목 미연결", amount });
  }
  const mokIds = [...parts.keys()].filter((k): k is number => k != null);
  if (mokIds.length) {
    for (const r of rowsOf(await exec.execute(sql`
      SELECT mok.id, mok.name, hang.name AS hang_name, gwan.name AS gwan_name
        FROM budget_accounts mok
        LEFT JOIN budget_accounts hang ON hang.id = mok.parent_id
        LEFT JOIN budget_accounts gwan ON gwan.id = hang.parent_id
       WHERE mok.id IN (${sql.join(mokIds.map((i) => sql`${i}`), sql`, `)})`))) {
      const part = parts.get(Number(r.id));
      if (part) part.label = [r.gwan_name, r.hang_name, r.name].filter(Boolean).join(" › ");
    }
  }
  const deduction = sum((r) => r.deduction);
  return {
    orgCount: slips.length,
    skipped,
    form: {
      year, month, slipIds: rows.map((r) => r.slipId), count: rows.length, gross, deduction, net: gross - deduction,
      noContract: rows.filter((r) => !r.contract).length, rows,
      budget: [...parts.values()].sort((a, b) => (a.budgetAccountId ?? 0) - (b.budgetAccountId ?? 0)),
      refreshedAt: new Date().toISOString(),
    },
  };
}

const NO_TARGET = "이 달에는 결재에 올릴 사단법인 급여가 없습니다. 근로계약의 사업자가 사단법인이거나 인건비 배부를 저장한 직원의 급여만 결재에 올립니다.";

function noSlipError(skipped: string[], orgCount: number): LedgerError {
  return orgCount
    ? new LedgerError("결재에 올릴 수 있는 급여 명세가 없습니다.", 422, skipped)
    : new LedgerError(NO_TARGET, 422);
}

/** 문서를 급여 명세의 값으로 맞춘다. 금액·내역·예산은 화면에서 고칠 수 없다 */
async function writePayrollForm(tx: QueryRunner, id: number, current: any, form: PayrollForm) {
  const people = `직원 ${form.count}명`;
  const formData = {
    ...(current && typeof current === "object" ? current : {}),
    items: [{ use: "인건비", content: `${form.year}년 ${form.month}월 급여`, payee: people, supply: form.gross, vat: 0 }],
    payees: [],
    payroll: form,
  };
  await tx.execute(sql`
    UPDATE approval_requests
       SET amount = ${form.gross}, form_data = ${JSON.stringify(formData)}::jsonb, pay_method = 'transfer',
           expense_kind = 'fixed_personnel', budget_account_id = ${form.budget[0]?.budgetAccountId ?? null}, budget_split_id = NULL,
           function_code = NULL, program_id = NULL, fund_id = NULL, fiscal_year = ${yearKST()}, payee_name = ${people}, updated_at = NOW()
     WHERE id = ${id}`);
}

/** 급여 관리의 «지급 결재 올리기». 같은 달에 고칠 수 있는 내 문서가 있으면 그 문서를 다시 맞추고, 없으면 임시저장을 만든다. */
export async function draftPayrollDoc(actor: { id: number; name: string }, year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || year < 2000 || month < 1 || month > 12) {
    throw new LedgerError("연도와 월을 확인해 주세요", 400);
  }
  return db.transaction(async (tx: any) => {
    const existing = rowsOf(await tx.execute(sql`
      SELECT id, form_data FROM approval_requests
       WHERE doc_type = 'expense' AND delete_status = 'none' AND drafter_id = ${actor.id}
         AND status IN ('draft', 'rejected', 'recalled')
         AND (form_data->'payroll'->>'year')::int = ${year} AND (form_data->'payroll'->>'month')::int = ${month}
       ORDER BY id DESC LIMIT 1 FOR UPDATE`))[0];
    const { form, skipped, orgCount } = await collectPayroll(tx, year, month, existing ? Number(existing.id) : 0);
    if (!form) throw noSlipError(skipped, orgCount);

    let id = existing ? Number(existing.id) : 0;
    if (!id) {
      const body = `<p>급여 관리에서 확정한 ${year}년 ${month}월 급여의 지급 결재입니다. 대상과 금액은 급여 내역을 따릅니다.</p>`;
      const row = rowsOf(await tx.execute(sql`
        INSERT INTO approval_requests
          (doc_type, title, amount, body, form_data, drafter_id, drafter_name, status, steps, fiscal_year, created_at, updated_at)
        VALUES ('expense', ${`${year}년 ${month}월 급여 지급`}, ${form.gross}, ${body}, '{}'::jsonb, ${actor.id}, ${actor.name},
                'draft', '[]'::jsonb, ${yearKST()}, NOW(), NOW())
        RETURNING id`))[0];
      id = Number(row.id);
    }
    await writePayrollForm(tx, id, existing?.form_data ?? { line: [] }, form);
    return { id, created: !existing, count: form.count, gross: form.gross, net: form.net, noContract: form.noContract, skipped };
  });
}

/** 상신 직전에 급여 명세의 지금 금액으로 문서를 다시 맞춘다. 승인 대상은 이 값으로 고정된다. */
export async function refreshPayrollDoc(tx: QueryRunner, doc: any): Promise<any> {
  const cur = payrollOf(doc.form_data)!;
  const { form, skipped, orgCount } = await collectPayroll(tx, Number(cur.year), Number(cur.month), Number(doc.id));
  if (!form) throw noSlipError(skipped, orgCount);
  await writePayrollForm(tx, Number(doc.id), doc.form_data, form);
  return rowsOf(await tx.execute(sql`SELECT * FROM approval_requests WHERE id = ${doc.id}`))[0];
}

/** 예산 과목별 처리. 승인은 예약, 지급 확인은 집행, 지급 전 취소는 해제다. 과목 번호 순서로 잠가 서로 막히지 않게 한다. */
export async function payrollBudgetStep(
  tx: QueryRunner, doc: any, type: BudgetTxnType, actor: { id: number | null; name: string },
  opts: { check?: boolean; paidOn?: string | null; note?: string | null } = {},
): Promise<void> {
  const p = payrollOf(doc.form_data);
  if (!p) throw new LedgerError("급여 지급 결재가 아닙니다.");
  const year = Number(doc.fiscal_year);
  const parts = [...(p.budget ?? [])].sort((a, b) => (a.budgetAccountId ?? 0) - (b.budgetAccountId ?? 0));
  const positions: BudgetPosition[] = [];
  for (const part of parts) {
    await lockBudget(tx, year, part.budgetAccountId);
    const position = await budgetPosition(tx, year, part.budgetAccountId);
    if (opts.check && position.hasPlan) {
      if (part.budgetAccountId == null) {
        throw new LedgerError(`급여 계정(${part.accountCode})이 예산 과목에 연결돼 있지 않아 승인할 수 없습니다. 예산 과목 설정에서 연결을 확인해 주세요.`);
      }
      if (part.amount > position.available) {
        throw new LedgerError(`예산 사용가능액을 넘어 승인할 수 없습니다. ${part.label} 사용가능액 ${won(position.available)}원, 결재 금액 ${won(part.amount)}원`);
      }
    }
    positions.push(position);
  }
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    await recordBudgetLedger(tx, {
      year, budgetAccountId: part.budgetAccountId, documentId: Number(doc.id), documentNo: doc.doc_no ?? doc.resolution_no ?? null,
      documentVersion: Number(doc.version) || 1, type, amount: part.amount, before: positions[i], paidOn: opts.paidOn ?? null,
      actor, key: `${type}:approval:${doc.id}:m${part.budgetAccountId ?? 0}`, note: opts.note ?? null,
    });
  }
}

/** 문서 상세의 예산 진행현황. 과목별로 보여 준다 */
export async function payrollBudgetView(exec: QueryRunner, doc: any) {
  const p = payrollOf(doc.form_data);
  if (!p) return [];
  const counted = doc.status === "approved" || doc.status === "canceled";
  const out: any[] = [];
  for (const part of p.budget ?? []) {
    const position = await budgetPosition(exec, Number(doc.fiscal_year), part.budgetAccountId);
    out.push({
      ...position, label: part.label, amount: part.amount,
      expectedAvailable: position.available - (counted ? 0 : part.amount),
    });
  }
  return out;
}

/** 지급 확인: 문서에 든 급여 명세를 한꺼번에 지급 완료로 바꾼다. 결재 뒤에 달라진 명세가 있으면 멈춘다. */
export async function settlePayrollSlips(tx: QueryRunner, doc: any, paidAt: string, actorId: number): Promise<number> {
  const p = payrollOf(doc.form_data);
  const ids = (p?.slipIds ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!p || !ids.length) throw new LedgerError("문서에 급여 명세가 없습니다.");
  const slips = rowsOf(await tx.execute(sql`
    SELECT id, status, gross_pay, total_deduction FROM payroll_slips
     WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) FOR UPDATE`));
  const byId = new Map<number, any>(slips.map((s: any) => [Number(s.id), s]));
  const problems: string[] = [];
  for (const row of p.rows ?? []) {
    const s = byId.get(Number(row.slipId));
    if (!s) problems.push(`${row.name}: 명세가 삭제됨`);
    else if (s.status === "PAID") problems.push(`${row.name}: 이미 지급 완료`);
    else if (s.status !== "APPROVED" && s.status !== "SENT") problems.push(`${row.name}: 급여 관리 상태가 ${STATUS_KO[s.status] ?? s.status}`);
    else if (Math.round(Number(s.gross_pay)) !== Number(row.gross) || Math.round(Number(s.total_deduction)) !== Number(row.deduction)) {
      problems.push(`${row.name}: 결재 뒤에 금액이 바뀜`);
    }
  }
  if ((p.rows ?? []).length !== ids.length) problems.push("문서의 급여 내역과 대상 명세 수가 다릅니다");
  if (problems.length) {
    throw new LedgerError("급여 명세가 결재 내용과 달라 지급 확인을 할 수 없습니다. 결재를 취소하고 다시 올려 주세요.", 422, problems);
  }
  /* 지급일은 실제 이체일의 한국 정오로 남긴다. 급여 관리의 지급 확정과 같은 규칙이다(원천징수 신고 기준일) */
  await tx.execute(sql`
    UPDATE payroll_slips
       SET status = 'PAID', paid_by = ${String(actorId)},
           paid_at = (${`${paidAt}T12:00:00+09:00`}::timestamptz AT TIME ZONE 'UTC'), updated_at = NOW()
     WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  return ids.length;
}
