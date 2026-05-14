/**
 * GET /api/admin-bank-transactions-list
 * 통장 거래 목록 — 입금/출금·매칭상태·기간 필터
 *
 * Query:
 *   ?importId=N           특정 업로드 건만
 *   ?txnType=credit|debit 입금/출금 필터
 *   ?matchType=...        매칭 타입 필터 (donation|donation_batch|voucher|revenue|ignored|pending)
 *   ?status=...           pending|confirmed|voucher_created|ignored
 *   ?startDate=&endDate=  기간 필터 (YYYY-MM-DD)
 *   ?page=1&limit=50
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-bank-transactions-list" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "거래 목록 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const importId  = url.searchParams.get("importId");
  const txnType   = url.searchParams.get("txnType");
  const matchType = url.searchParams.get("matchType");
  const status    = url.searchParams.get("status");
  const startDate = url.searchParams.get("startDate");
  const endDate   = url.searchParams.get("endDate");
  const page  = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
  const offset = (page - 1) * limit;

  try {
    const r: any = await db.execute(sql`
      SELECT bt.id, bt.import_id, bt.txn_date, bt.amount, bt.description,
             bt.counterpart, bt.balance_after, bt.txn_type,
             bt.counterpart_account, bt.counterpart_bank, bt.counterpart_name,
             bt.txn_method, bt.memo, bt.cms_code,
             bt.ai_account_code, bt.ai_confidence, bt.ai_reasoning,
             bt.match_type, bt.status,
             bt.admin_account_code, bt.counterparty_id,
             bt.donation_id, bt.other_revenue_id, bt.voucher_id,
             bt.confirmed_by, bt.confirmed_at,
             cp.name AS counterparty_name_master,
             v.voucher_number
      FROM bank_transactions bt
      LEFT JOIN counterparties cp ON cp.id = bt.counterparty_id
      LEFT JOIN vouchers v ON v.id = bt.voucher_id
      WHERE 1=1
        ${importId  ? sql`AND bt.import_id = ${Number(importId)}` : sql``}
        ${txnType   ? sql`AND bt.txn_type = ${txnType}` : sql``}
        ${matchType ? sql`AND bt.match_type = ${matchType}` : sql``}
        ${status    ? sql`AND bt.status = ${status}` : sql``}
        ${startDate ? sql`AND bt.txn_date >= ${startDate}` : sql``}
        ${endDate   ? sql`AND bt.txn_date <= ${endDate}` : sql``}
      ORDER BY bt.txn_date DESC, bt.id DESC
      LIMIT ${limit} OFFSET ${offset}`);
    const rows = r?.rows ?? r ?? [];

    let total = 0;
    try {
      const c: any = await db.execute(sql`
        SELECT COUNT(*) AS n FROM bank_transactions bt
        WHERE 1=1
          ${importId  ? sql`AND bt.import_id = ${Number(importId)}` : sql``}
          ${txnType   ? sql`AND bt.txn_type = ${txnType}` : sql``}
          ${matchType ? sql`AND bt.match_type = ${matchType}` : sql``}
          ${status    ? sql`AND bt.status = ${status}` : sql``}
          ${startDate ? sql`AND bt.txn_date >= ${startDate}` : sql``}
          ${endDate   ? sql`AND bt.txn_date <= ${endDate}` : sql``}`);
      total = Number((c?.rows ?? c ?? [])[0]?.n ?? 0);
    } catch { /* total 보조 */ }

    return new Response(JSON.stringify({
      ok: true,
      data: {
        transactions: rows.map((x: any) => ({
          id: Number(x.id),
          importId: Number(x.import_id),
          txnDate: x.txn_date,
          amount: Number(x.amount),
          txnType: x.txn_type,
          description: x.description,
          counterpartName: x.counterpart_name || x.counterpart,
          counterpartAccount: x.counterpart_account,
          counterpartBank: x.counterpart_bank,
          txnMethod: x.txn_method,
          memo: x.memo,
          cmsCode: x.cms_code,
          balanceAfter: x.balance_after !== null ? Number(x.balance_after) : null,
          matchType: x.match_type,
          status: x.status,
          aiAccountCode: x.ai_account_code,
          aiConfidence: x.ai_confidence !== null ? Number(x.ai_confidence) : null,
          aiReasoning: x.ai_reasoning,
          adminAccountCode: x.admin_account_code,
          counterpartyId: x.counterparty_id ? Number(x.counterparty_id) : null,
          counterpartyMasterName: x.counterparty_name_master,
          donationId: x.donation_id ? Number(x.donation_id) : null,
          otherRevenueId: x.other_revenue_id ? Number(x.other_revenue_id) : null,
          voucherId: x.voucher_id ? Number(x.voucher_id) : null,
          voucherNumber: x.voucher_number,
          confirmedBy: x.confirmed_by,
          confirmedAt: x.confirmed_at,
        })),
        page, limit, total,
      },
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("select", err);
  }
}
