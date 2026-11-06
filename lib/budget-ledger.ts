// lib/budget-ledger.ts — 예산 사용가능액 계산과 예산 원장 (2026-11-06)
//
// 설계도 10·13·14쪽. 최종 승인 때 사용가능액을 다시 계산하고, 예약·집행·해제·환입을 지우지 않고 쌓는다.
// 예약 잔액은 별도 표에 두지 않고 승인·미지급 문서 합으로 계산한다(로드맵 §2-3). 원장은 이력이다.
// 연결 1개 환경이라 트랜잭션 안에서는 인자로 받은 tx만 쓴다.
import { sql } from "drizzle-orm";
import { type QueryRunner, voucherCostsByMok } from "./finance-budget-report";

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];

export interface BudgetPosition {
  /** 승인된 예산안이 있는 연도인가. 없으면 사용가능액을 판단할 수 없다 */
  hasPlan: boolean;
  lineId: number | null;
  planned: number;
  executed: number;
  reserved: number;
  /** 현재예산 − 집행액 */
  remaining: number;
  /** 현재예산 − 집행액 − 미집행 예약액 */
  available: number;
}

/** 같은 예산 목을 동시에 예약·집행하지 못하게 트랜잭션이 끝날 때까지 잠근다 */
export async function lockBudget(tx: QueryRunner, year: number, budgetAccountId: number | null): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`budget:${year}:${budgetAccountId ?? 0}`}))`);
}

export async function budgetPosition(exec: QueryRunner, year: number, budgetAccountId: number | null): Promise<BudgetPosition> {
  const plan = rowsOf(await exec.execute(sql`
    SELECT bl.id AS line_id, bl.planned_amount
      FROM budget_plans p
      LEFT JOIN budget_lines bl ON bl.plan_id = p.id AND bl.budget_account_id = ${budgetAccountId}
     WHERE p.fiscal_year = ${year} AND p.status = 'approved'
     LIMIT 1`))[0];
  const hasPlan = !!plan;
  const lineId = plan?.line_id == null ? null : Number(plan.line_id);
  const planned = Number(plan?.planned_amount) || 0;

  const spent = rowsOf(await exec.execute(sql`
    SELECT COALESCE(SUM(amount - refund_amount), 0)::bigint AS total
      FROM expenses
     WHERE fiscal_year = ${year} AND status = 'approved' AND budget_account_id = ${budgetAccountId}`))[0];
  const { byMok } = await voucherCostsByMok(exec, year);
  const executed = (Number(spent?.total) || 0) + (budgetAccountId == null ? 0 : byMok.get(budgetAccountId) ?? 0);

  const unpaid = rowsOf(await exec.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::bigint AS total
      FROM approval_requests
     WHERE status = 'approved' AND payment_status = 'unpaid'
       AND fiscal_year = ${year} AND budget_account_id = ${budgetAccountId}`))[0];
  let reserved = Number(unpaid?.total) || 0;
  if (lineId != null) {
    const submitted = rowsOf(await exec.execute(sql`
      SELECT COALESCE(SUM(amount), 0)::bigint AS total
        FROM vouchers
       WHERE budget_line_id = ${lineId} AND fiscal_year = ${year}
         AND is_template = FALSE AND status = 'submitted'`))[0];
    reserved += Number(submitted?.total) || 0;
  }

  return {
    hasPlan, lineId, planned, executed, reserved,
    remaining: planned - executed,
    available: planned - executed - reserved,
  };
}

export type BudgetTxnType = "reserve" | "execute" | "release" | "refund" | "correction";

export interface BudgetLedgerEntry {
  year: number;
  budgetAccountId: number | null;
  documentType?: string;
  documentId: number;
  documentNo?: string | null;
  documentVersion?: number;
  type: BudgetTxnType;
  amount: number;
  /** 이 처리 전의 예산 위치 */
  before: BudgetPosition;
  paidOn?: string | null;
  actor: { id: number | null; name: string };
  originId?: number | null;
  /** 같은 거래가 두 번 기록되지 않게 하는 키 */
  key: string;
  note?: string | null;
}

/** 원장 한 줄. 같은 키는 다시 기록하지 않는다. */
export async function recordBudgetLedger(tx: QueryRunner, e: BudgetLedgerEntry): Promise<void> {
  const reservedAfter = e.before.reserved + (e.type === "reserve" ? e.amount : e.type === "execute" || e.type === "release" ? -e.amount : 0);
  const executedAfter = e.before.executed + (e.type === "execute" ? e.amount : e.type === "refund" ? -e.amount : 0);
  await tx.execute(sql`
    INSERT INTO budget_ledger
      (fiscal_year, budget_account_id, document_type, document_id, document_no, document_version, txn_type, amount,
       reserved_before, reserved_after, executed_before, executed_after, paid_on, actor_id, actor_name,
       origin_id, idempotency_key, note)
    VALUES
      (${e.year}, ${e.budgetAccountId}, ${e.documentType ?? "approval_request"}, ${e.documentId}, ${e.documentNo ?? null},
       ${e.documentVersion ?? 1}, ${e.type}, ${e.amount}, ${e.before.reserved}, ${reservedAfter},
       ${e.before.executed}, ${executedAfter}, ${e.paidOn ?? null}, ${e.actor.id}, ${e.actor.name},
       ${e.originId ?? null}, ${e.key}, ${e.note ?? null})
    ON CONFLICT (idempotency_key) DO NOTHING`);
}
