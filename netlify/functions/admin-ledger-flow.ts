/**
 * GET /api/admin-ledger-flow
 * 장부 › 자금 연결. 자동 전표 현황, 통장 잔액 대조, 정산 미수금, 미지급 결재,
 * 결재 없는 출금, 결재 없는 지출을 한 번에 돌려준다.
 * 보조 항목이 실패해도 나머지는 그대로 응답한다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { SOURCE_LABEL, pendingStatus } from "../../lib/ledger-auto";
import { ymd } from "../../lib/ledger-post";
import { loadFiscalYears } from "../../lib/ledger-report";

export const config = { path: "/api/admin-ledger-flow" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    console.warn(`[ledger-flow] ${label} 실패 (빈 값으로 계속):`, err?.message);
    return fallback;
  }
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "GET 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  try {
    const fiscalYears = await loadFiscalYears();
    const start = fiscalYears[0]?.startDate ?? "9999-12-31";

    const pending = await safe("미반영", () => pendingStatus(), { total: 0, blocked: 0, bySource: {} as Record<string, number> });

    const drafts = await safe("작성중 자동 전표", async () => Number(rowsOf(await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM vouchers
       WHERE source_type IS NOT NULL AND status IN ('draft','rejected') AND voucher_date >= ${start}`))[0]?.n ?? 0), 0);

    const lastRun = await safe("마지막 실행", async () => {
      const r = rowsOf(await db.execute(sql`
        SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS at_kst, after_data
          FROM ledger_history WHERE entity = 'ledger_sync' ORDER BY id DESC LIMIT 1`))[0];
      return r ? { at: r.at_kst, result: r.after_data } : null;
    }, null);

    const bank = await safe("통장 대조", async () => {
      const book = rowsOf(await db.execute(sql`
        SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint AS balance
          FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
          JOIN account_codes a ON a.code = l.account_code
         WHERE a.system_role = 'cash_default' AND v.status = 'approved' AND v.is_template = FALSE`))[0];
      const latest = rowsOf(await db.execute(sql`
        SELECT b.balance_after, b.txn_date
          FROM bank_transactions b
          JOIN bank_imports i ON i.id = b.import_id
         WHERE i.account_code = '1012' AND b.balance_after IS NOT NULL
         ORDER BY b.txn_date DESC, b.id DESC LIMIT 1`))[0];
      const bookBalance = Number(book?.balance) || 0;
      const bankBalance = latest ? Number(latest.balance_after) : null;
      return {
        bookBalance, bankBalance, asOf: latest ? ymd(latest.txn_date) : null,
        difference: bankBalance === null ? null : bankBalance - bookBalance,
      };
    }, { bookBalance: 0, bankBalance: null, asOf: null, difference: null });

    const settlement = await safe("정산 미수금", async () => {
      const r = rowsOf(await db.execute(sql`
        SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint AS balance
          FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
          JOIN account_codes a ON a.code = l.account_code
         WHERE a.system_role = 'settlement_receivable' AND v.status = 'approved' AND v.is_template = FALSE`))[0];
      return Number(r?.balance) || 0;
    }, 0);

    const unpaid = await safe("미지급 결재", async () => rowsOf(await db.execute(sql`
      SELECT r.id, r.request_no, r.resolution_no, r.title, r.amount, r.payee_name, r.decided_at, r.function_code,
             to_char(r.decided_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS decided_on,
             b.name AS budget_name, p.name AS program_name, f.name AS fund_name
        FROM approval_requests r
        LEFT JOIN budget_accounts b ON b.id = r.budget_account_id
        LEFT JOIN ledger_programs p ON p.id = r.program_id
        LEFT JOIN ledger_funds f ON f.id = r.fund_id
       WHERE r.status = 'approved' AND r.payment_status = 'unpaid'
       ORDER BY r.decided_at, r.id LIMIT 200`)).map((r: any) => ({
      id: Number(r.id), requestNo: r.request_no, resolutionNo: r.resolution_no, title: r.title, amount: Number(r.amount),
      payeeName: r.payee_name, decidedOn: r.decided_on, budgetName: r.budget_name, functionCode: r.function_code,
      programName: r.program_name, fundName: r.fund_name,
    })), [] as any[]);

    /* 장부 기간 안의 출금 중 결재·지출과 연결되지 않은 것 */
    const noApproval = await safe("결재 없는 출금", async () => rowsOf(await db.execute(sql`
      SELECT b.id, b.txn_date, b.amount, b.description, b.counterpart_name, b.status, b.voucher_id,
             v.voucher_number, v.status AS voucher_status
        FROM bank_transactions b
        LEFT JOIN vouchers v ON v.id = b.voucher_id
       WHERE b.txn_type = 'debit' AND b.status <> 'ignored' AND b.txn_date >= ${start}
         AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.bank_txn_id = b.id AND e.status = 'approved')
         AND NOT EXISTS (SELECT 1 FROM approval_requests a WHERE a.bank_txn_id = b.id)
       ORDER BY b.txn_date DESC, b.id DESC LIMIT 100`)).map((r: any) => ({
      id: Number(r.id), date: ymd(r.txn_date), amount: Math.abs(Number(r.amount)), description: r.description,
      counterpart: r.counterpart_name, status: r.status,
      voucherId: r.voucher_id == null ? null : Number(r.voucher_id),
      voucherNumber: r.voucher_number, voucherStatus: r.voucher_status,
    })), [] as any[]);

    /* 결재를 거치지 않고 직접 등록한 승인 지출 */
    const directExpenses = await safe("결재 없는 지출", async () => rowsOf(await db.execute(sql`
      SELECT e.id, e.occurred_at, e.amount, e.payee_name, e.description
        FROM expenses e
       WHERE e.status = 'approved' AND e.occurred_at >= ${start}
         AND NOT EXISTS (SELECT 1 FROM approval_requests a WHERE a.expense_id = e.id)
       ORDER BY e.occurred_at DESC, e.id DESC LIMIT 100`)).map((r: any) => ({
      id: Number(r.id), date: ymd(r.occurred_at), amount: Number(r.amount), payeeName: r.payee_name, description: r.description,
    })), [] as any[]);

    return new Response(jsonKST({
      ok: true,
      data: {
        ledgerStart: start, sourceLabels: SOURCE_LABEL,
        sync: { ...pending, drafts, lastRun },
        bank, settlement, unpaid, noApproval, directExpenses,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "자금 연결 조회 실패", step: "select",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
