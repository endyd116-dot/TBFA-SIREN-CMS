/**
 * POST /api/admin-approval-pay
 * body: { requestId, paidAt:'YYYY-MM-DD', evidenceChecked:true, payAccountCode?, bankTxnId? }
 *
 * 지급 확인. 승인된 결재의 돈이 실제로 나간 시점에 지출을 만들고 장부에 옮긴다.
 * 승인만으로는 예약일 뿐이며, 이 처리가 끝나야 손익·집행에 들어간다.
 * 통장 출금을 연결하면 그 거래는 처리 완료가 되고 결재 없는 출금에서 빠진다.
 * 설계도 10·14쪽: 지급일 입력과 증빙 확인 뒤 처리하고, 전용 권한(finance_payment_confirm)으로 막는다.
 * 금액은 승인액 그대로다. 실제 지급액이 다르면 체크하지 않고 정정 또는 취소·재기안한다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { LedgerError, ledgerActor, ledgerErrorBody, recordHistory } from "../../lib/ledger-post";
import { syncLedger } from "../../lib/ledger-auto";
import { budgetPosition, lockBudget, recordBudgetLedger } from "../../lib/budget-ledger";

export const config = { path: "/api/admin-approval-pay" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const JSON_HEADERS = { "Content-Type": "application/json" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST 메서드만 허용" }), { status: 405, headers: JSON_HEADERS });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const requestId = Number(body?.requestId) || 0;
  const paidAt = String(body?.paidAt ?? "");
  const payAccountCode = body?.payAccountCode ? String(body.payAccountCode) : null;
  const bankTxnId = Number(body?.bankTxnId) || null;
  if (!requestId || !/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) {
    return new Response(jsonKST({ ok: false, error: "requestId, paidAt(YYYY-MM-DD) 필수" }), { status: 400, headers: JSON_HEADERS });
  }
  if (body?.evidenceChecked !== true) {
    return new Response(jsonKST({ ok: false, error: "증빙을 확인한 뒤 체크해 주세요" }), { status: 400, headers: JSON_HEADERS });
  }

  const myId = Number(auth.ctx.admin.uid);
  const actor = ledgerActor(auth);
  try {
    const paid = await db.transaction(async (tx) => {
      const r = rowsOf(await tx.execute(sql`
        SELECT id, title, amount, status, payment_status, fiscal_year, budget_account_id, payee_name,
               evidence_url, drafter_id, function_code, program_id, fund_id, resolution_no
          FROM approval_requests WHERE id = ${requestId} FOR UPDATE`))[0];
      if (!r) throw new LedgerError("결재를 찾을 수 없습니다", 404);
      if (r.status !== "approved") throw new LedgerError("최종 승인된 결재만 지급 확인할 수 있습니다.");
      if (r.payment_status !== "unpaid") throw new LedgerError("이미 지급 확인된 결재입니다.");

      const year = Number(r.fiscal_year);
      const budgetAccountId = r.budget_account_id == null ? null : Number(r.budget_account_id);
      await lockBudget(tx, year, budgetAccountId);
      const position = await budgetPosition(tx, year, budgetAccountId);

      let cashCode = payAccountCode;
      if (bankTxnId) {
        const txn = rowsOf(await tx.execute(sql`
          SELECT b.id, b.amount, b.txn_type, b.status, b.voucher_id, b.txn_date, i.account_code
            FROM bank_transactions b LEFT JOIN bank_imports i ON i.id = b.import_id
           WHERE b.id = ${bankTxnId} FOR UPDATE OF b`))[0];
        if (!txn) throw new LedgerError("통장 거래를 찾을 수 없습니다", 404);
        if (txn.txn_type !== "debit") throw new LedgerError("출금 거래만 연결할 수 있습니다.");
        if (txn.voucher_id || txn.status !== "pending") throw new LedgerError("이미 처리된 통장 거래입니다.");
        cashCode = cashCode || txn.account_code || null;
        await tx.execute(sql`
          UPDATE bank_transactions
             SET match_type = 'expense', status = 'confirmed', confirmed_at = NOW(), confirmed_by = ${actor.name}
           WHERE id = ${bankTxnId}`);
      }

      const expense = rowsOf(await tx.execute(sql`
        INSERT INTO expenses
          (fiscal_year, occurred_at, category_id, budget_account_id, amount, payee_name, description, receipt_url,
           status, recorded_by, recorded_at, approved_by, approved_at,
           function_code, program_id, fund_id, bank_txn_id, pay_account_code)
        VALUES
          (${Number(r.fiscal_year)}, ${paidAt}, NULL, ${r.budget_account_id}, ${Number(r.amount)}, ${r.payee_name ?? null},
           ${r.title}, ${r.evidence_url ?? null}, 'approved', ${r.drafter_id ?? null}, NOW(), ${myId}, NOW(),
           ${r.function_code ?? null}, ${r.program_id ?? null}, ${r.fund_id ?? null}, ${bankTxnId}, ${cashCode})
        RETURNING id`))[0];
      const expenseId = Number(expense.id);

      await tx.execute(sql`
        UPDATE approval_requests
           SET payment_status = 'paid', paid_at = ${paidAt}, paid_by = ${myId}, bank_txn_id = ${bankTxnId},
               pay_account_code = ${cashCode}, expense_id = ${expenseId}, updated_at = NOW()
         WHERE id = ${requestId}`);
      await recordBudgetLedger(tx, {
        year, budgetAccountId, documentId: requestId, documentNo: r.resolution_no, type: "execute",
        amount: Number(r.amount), before: position, paidOn: paidAt, actor, key: `execute:approval:${requestId}`,
      });
      await recordHistory(tx, {
        entity: "approval", entityId: requestId, action: "paid", actor,
        after: { resolutionNo: r.resolution_no, amount: Number(r.amount), paidAt, expenseId, bankTxnId },
      });
      return { expenseId, resolutionNo: r.resolution_no };
    });

    /* 장부 반영은 커밋 뒤에 한다. 실패해도 지급 확인은 유효하고 야간 반영에서 처리된다 */
    let ledger: any = null;
    try {
      ledger = await syncLedger({ only: ["expense"] });
    } catch (err: any) {
      console.warn("[approval-pay] 장부 반영 실패(야간 재시도):", err?.message);
    }
    return new Response(jsonKST({ ok: true, data: { ...paid, ledger } }), { status: 200, headers: JSON_HEADERS });
  } catch (err: any) {
    const { status, body: payload } = ledgerErrorBody("pay", "지급 확인 실패", err);
    return new Response(jsonKST(payload), { status, headers: JSON_HEADERS });
  }
}
