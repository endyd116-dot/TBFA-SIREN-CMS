/**
 * POST /api/admin-bank-reconcile
 * 대사 엔진 실행 — pending 거래에 입금 대사 + 출금 전표생성 적용
 *
 * Body: {
 *   importId?: number    특정 업로드 건만 (생략 시 전체 pending)
 *   threshold?: number   신뢰도 임계값 (0~1, 기본 0.75)
 * }
 *
 * 동작:
 *  - 입금(credit): reconcileIncome → 묶음정산/개별후원/미매칭 분기
 *  - 출금(debit):  reconcileExpense → 거래처/키워드/AI → ≥threshold면 voucher draft 자동 생성
 *  - IBK 통장 월 수십~수백 건 — 동기 처리로 충분
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import {
  reconcileIncome, reconcileExpense,
  type NormalizedTxn,
} from "../../lib/bank-reconcile";
import { nextVoucherNumber } from "../../lib/voucher-number";

export const config = { path: "/api/admin-bank-reconcile" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "대사 실행 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

/** voucher draft 자동 생성 — voucher_number 'YYYYMM-NNN'.
 *  Q4-023/Q4-024: 트랜잭션(tx) 안에서 advisory lock 발번 후 INSERT. 실패 시 throw → 호출 tx 롤백.
 *  (이전엔 분리 실행 + null 반환이라 전표만 생기고 거래는 pending → 재실행 시 중복 전표 위험) */
async function createVoucherDraftTx(tx: any, params: {
  txnDate: string; accountCode: string; accountName: string;
  description: string; payeeName: string | null; amount: number;
  budgetLineId: number | null; bankTxnId: number; createdBy: string;
}): Promise<number> {
  const { txnDate, accountCode, accountName, description, payeeName,
          amount, budgetLineId, bankTxnId, createdBy } = params;
  const yyyymm = String(txnDate).slice(0, 7).replace("-", "");
  const voucherNumber = await nextVoucherNumber(tx, yyyymm);
  const fiscalYear = parseInt(String(txnDate).slice(0, 4));

  const r: any = await tx.execute(sql`
    INSERT INTO vouchers (
      voucher_number, voucher_date, fiscal_year,
      account_code, account_name, description, payee_name, amount,
      evidence_type, budget_line_id, bank_txn_id,
      status, created_by, created_at, updated_at
    ) VALUES (
      ${voucherNumber}, ${txnDate}, ${fiscalYear},
      ${accountCode}, ${accountName}, ${description}, ${payeeName}, ${amount},
      'transfer_confirm', ${budgetLineId}, ${bankTxnId},
      'draft', ${createdBy}, NOW(), NOW()
    ) RETURNING id`);
  const row = (r?.rows ?? r ?? [])[0];
  if (!row) throw new Error("voucher draft INSERT가 id를 반환하지 않음");
  return Number(row.id);
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const createdBy = String(auth.ctx.member?.email || auth.ctx.admin?.uid || "admin");

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const importId  = body.importId ? Number(body.importId) : null;
  let threshold = Number(body.threshold);
  if (isNaN(threshold) || threshold <= 0 || threshold > 1) threshold = 0.75;

  // ── 대상 거래 조회 — pending 상태만 ────────────────────────
  let txns: any[];
  try {
    const r: any = await db.execute(sql`
      SELECT id, import_id, txn_date, amount, description, txn_type,
             counterpart_account, counterpart_bank, counterpart_name,
             txn_method, memo, cms_code, balance_after, dedup_hash
      FROM bank_transactions
      WHERE status = 'pending'
        ${importId ? sql`AND import_id = ${importId}` : sql``}
      ORDER BY txn_date ASC, id ASC
      LIMIT 1000`);
    txns = r?.rows ?? r ?? [];
  } catch (err: any) {
    return jsonError("select_pending", err);
  }

  if (txns.length === 0) {
    return new Response(JSON.stringify({
      ok: true,
      data: { processed: 0, message: "대사할 pending 거래 0건" },
    }), { headers: { "Content-Type": "application/json" } });
  }

  const stats = {
    processed: 0,
    incomeMatched: 0,      // 개별 후원 매칭 confirmed
    incomeBatch: 0,        // 묶음 정산
    incomePending: 0,      // 입금 미매칭 → 관리자 확인 대기
    expenseVoucher: 0,     // 출금 → voucher draft 자동 생성
    expensePending: 0,     // 출금 → 신뢰도 부족, 관리자 대기
    errors: 0,
  };

  for (const t of txns) {
    const txn: NormalizedTxn = {
      txnDate: String(t.txn_date),
      txnDateTime: String(t.txn_date),
      amount: Number(t.amount),
      txnType: t.txn_type === "credit" ? "credit" : "debit",
      description: t.description || "",
      counterpartAccount: t.counterpart_account,
      counterpartBank: t.counterpart_bank,
      counterpartName: t.counterpart_name,
      txnMethod: t.txn_method,
      memo: t.memo,
      cmsCode: t.cms_code,
      balanceAfter: t.balance_after !== null ? Number(t.balance_after) : null,
      dedupHash: t.dedup_hash || "",
    };

    try {
      if (txn.txnType === "credit") {
        // ── 입금 대사 ──────────────────────────────────────
        const result = await reconcileIncome(txn, threshold);
        if (result.matchType === "donation" && result.status === "confirmed" && result.donationId) {
          await db.execute(sql`
            UPDATE bank_transactions SET
              match_type = 'donation', status = 'confirmed',
              donation_id = ${result.donationId},
              ai_confidence = ${result.confidence ?? null},
              ai_reasoning = ${result.reasoning},
              confirmed_at = NOW(), confirmed_by = ${createdBy}
            WHERE id = ${t.id}`);
          stats.incomeMatched++;
        } else if (result.matchType === "donation_batch") {
          await db.execute(sql`
            UPDATE bank_transactions SET
              match_type = 'donation_batch',
              status = ${result.status === "confirmed" ? "confirmed" : "pending"},
              ai_confidence = ${result.confidence ?? null},
              ai_reasoning = ${result.reasoning}
              ${result.status === "confirmed" ? sql`, confirmed_at = NOW(), confirmed_by = ${createdBy}` : sql``}
            WHERE id = ${t.id}`);
          stats.incomeBatch++;
        } else {
          // pending / revenue 후보 — match_type 기록만, status는 pending 유지 (관리자 확인 대기)
          await db.execute(sql`
            UPDATE bank_transactions SET
              match_type = ${result.matchType},
              counterparty_id = ${result.counterpartyId ?? null},
              ai_confidence = ${result.confidence ?? null},
              ai_reasoning = ${result.reasoning}
            WHERE id = ${t.id}`);
          stats.incomePending++;
        }
      } else {
        // ── 출금 대사 ──────────────────────────────────────
        const result = await reconcileExpense(txn, threshold);
        if (result.autoCreateVoucher && result.accountCode && result.accountName) {
          /* Q4-023: 전표 INSERT + 통장거래 UPDATE를 한 트랜잭션으로 — 중간 실패 시 양쪽 롤백 */
          await db.transaction(async (tx) => {
            const voucherId = await createVoucherDraftTx(tx, {
              txnDate: txn.txnDate,
              accountCode: result.accountCode!,
              accountName: result.accountName!,
              description: txn.description || `통장 출금 — ${txn.counterpartName || ""}`,
              payeeName: txn.counterpartName,
              amount: Math.abs(txn.amount),
              budgetLineId: result.budgetLineId ?? null,
              bankTxnId: Number(t.id),
              createdBy,
            });
            await tx.execute(sql`
              UPDATE bank_transactions SET
                match_type = 'voucher', status = 'voucher_created',
                counterparty_id = ${result.counterpartyId ?? null},
                ai_account_code = ${result.accountCode},
                ai_confidence = ${result.confidence},
                ai_reasoning = ${result.reasoning},
                voucher_id = ${voucherId},
                confirmed_at = NOW(), confirmed_by = ${createdBy}
              WHERE id = ${t.id}`);
          });
          stats.expenseVoucher++;
        } else {
          // 신뢰도 부족 — 추정 계정과목 기록, 관리자 확인 대기
          await db.execute(sql`
            UPDATE bank_transactions SET
              match_type = 'pending',
              counterparty_id = ${result.counterpartyId ?? null},
              ai_account_code = ${result.accountCode ?? null},
              ai_confidence = ${result.confidence},
              ai_reasoning = ${result.reasoning}
            WHERE id = ${t.id}`);
          stats.expensePending++;
        }
      }
      stats.processed++;
    } catch (e: any) {
      console.warn(`[bank-reconcile] 거래 ${t.id} 대사 실패:`, e?.message);
      stats.errors++;
    }
  }

  // ── bank_imports 카운터 갱신 ───────────────────────────────
  if (importId) {
    try {
      await db.execute(sql`
        UPDATE bank_imports SET
          auto_matched = (SELECT COUNT(*) FROM bank_transactions
                          WHERE import_id = ${importId} AND status IN ('confirmed', 'voucher_created')),
          pending_review = (SELECT COUNT(*) FROM bank_transactions
                            WHERE import_id = ${importId} AND status = 'pending'),
          ignored_rows = (SELECT COUNT(*) FROM bank_transactions
                          WHERE import_id = ${importId} AND status = 'ignored'),
          status = 'completed'
        WHERE id = ${importId}`);
    } catch (e) {
      console.warn("[bank-reconcile] bank_imports 카운터 갱신 실패:", e);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    data: {
      ...stats,
      threshold,
      message: `대사 완료 — ${stats.processed}건 처리 (입금 매칭 ${stats.incomeMatched}, 묶음정산 ${stats.incomeBatch}, 입금 대기 ${stats.incomePending}, 전표생성 ${stats.expenseVoucher}, 출금 대기 ${stats.expensePending})`,
    },
  }), { headers: { "Content-Type": "application/json" } });
}
