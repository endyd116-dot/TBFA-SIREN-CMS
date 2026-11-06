/**
 * POST /api/admin-approval-refund
 * body: { requestId, refundAmount, note? }
 *
 * 지급 뒤 취소된 결재의 반환 확인. 설계도 10·11쪽: 취소만으로 집행액을 되돌리지 않고,
 * 실제로 돈이 돌아온 것을 확인할 때만 환입한다. 돌아오지 않았으면 0원으로 종료한다(사유 필수).
 * 환입은 지출의 환불액으로 처리해 예산 집행과 장부가 같은 경로로 줄어든다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { LedgerError, ledgerActor, ledgerErrorBody, recordHistory } from "../../lib/ledger-post";
import { budgetPosition, lockBudget, recordBudgetLedger } from "../../lib/budget-ledger";
import { syncLedger } from "../../lib/ledger-auto";

export const config = { path: "/api/admin-approval-refund" };

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
  const refundAmount = Math.trunc(Number(body?.refundAmount));
  const note = String(body?.note ?? "").trim().slice(0, 300) || null;
  if (!requestId || !Number.isFinite(refundAmount) || refundAmount < 0) {
    return new Response(jsonKST({ ok: false, error: "requestId, refundAmount(0 이상) 필수" }), { status: 400, headers: JSON_HEADERS });
  }
  if (refundAmount === 0 && !note) {
    return new Response(jsonKST({ ok: false, error: "반환받지 못한 사유를 입력하세요" }), { status: 400, headers: JSON_HEADERS });
  }

  const actor = ledgerActor(auth);
  try {
    const result = await db.transaction(async (tx) => {
      const r = rowsOf(await tx.execute(sql`
        SELECT id, title, status, refund_status, expense_id, fiscal_year, budget_account_id, resolution_no
          FROM approval_requests WHERE id = ${requestId} FOR UPDATE`))[0];
      if (!r) throw new LedgerError("결재를 찾을 수 없습니다", 404);
      if (r.refund_status !== "required") throw new LedgerError("반환 확인 대상이 아닙니다.");
      if (!r.expense_id) throw new LedgerError("연결된 지출이 없습니다.");

      const expense = rowsOf(await tx.execute(sql`
        SELECT id, amount, refund_amount FROM expenses WHERE id = ${r.expense_id} FOR UPDATE`))[0];
      if (!expense) throw new LedgerError("연결된 지출을 찾을 수 없습니다", 404);
      const cumulative = (Number(expense.refund_amount) || 0) + refundAmount;
      if (cumulative > Number(expense.amount)) throw new LedgerError("반환액이 지출액을 넘습니다.");

      const year = Number(r.fiscal_year);
      const budgetAccountId = r.budget_account_id == null ? null : Number(r.budget_account_id);
      await lockBudget(tx, year, budgetAccountId);
      const position = await budgetPosition(tx, year, budgetAccountId);

      if (refundAmount > 0) {
        await tx.execute(sql`UPDATE expenses SET refund_amount = ${cumulative}, updated_at = NOW() WHERE id = ${r.expense_id}`);
        await recordBudgetLedger(tx, {
          year, budgetAccountId, documentId: requestId, documentNo: r.resolution_no, type: "refund",
          amount: refundAmount, before: position, actor, key: `refund:approval:${requestId}`, note,
        });
      }
      await tx.execute(sql`
        UPDATE approval_requests
           SET refund_status = 'done', refund_confirmed_at = NOW(), refund_confirmed_by = ${actor.id}, updated_at = NOW()
         WHERE id = ${requestId}`);
      await recordHistory(tx, {
        entity: "approval", entityId: requestId, action: "refund_confirmed", actor, reason: note,
        after: { resolutionNo: r.resolution_no, refundAmount },
      });
      return { requestId, refundAmount };
    });

    /* 장부 반영은 커밋 뒤에 한다. 실패해도 야간 반영에서 처리된다 */
    let ledger: any = null;
    if (result.refundAmount > 0) {
      try {
        ledger = await syncLedger({ only: ["expense_refund"] });
      } catch (err: any) {
        console.warn("[approval-refund] 장부 반영 실패(야간 재시도):", err?.message);
      }
    }
    return new Response(jsonKST({ ok: true, data: { ...result, ledger } }), { status: 200, headers: JSON_HEADERS });
  } catch (err: any) {
    const { status, body: payload } = ledgerErrorBody("refund", "반환 확인 실패", err);
    return new Response(jsonKST(payload), { status, headers: JSON_HEADERS });
  }
}
