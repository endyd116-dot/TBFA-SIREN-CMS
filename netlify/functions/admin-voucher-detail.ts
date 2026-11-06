import { isoUTC, jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-voucher-detail" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "전표 상세 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0");
  if (!id) {
    return new Response(jsonKST({ ok: false, error: "id 파라미터 필요" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const rows: any = await db.execute(sql`
      SELECT
        v.id, v.voucher_number, v.voucher_date, v.fiscal_year,
        v.account_code, v.account_name, v.sub_account,
        v.description, v.payee_name, v.amount,
        v.evidence_type, v.evidence_number, v.evidence_url,
        v.budget_line_id, v.expense_id, v.bank_txn_id,
        v.is_template, v.template_name,
        v.status, v.rejection_reason,
        v.created_by, v.submitted_at, v.approved_by, v.approved_at,
        v.created_at, v.updated_at
      FROM vouchers v
      WHERE v.id = ${id}
      LIMIT 1
    `);
    const voucher = (rows?.rows ?? rows ?? [])[0];
    if (!voucher) {
      return new Response(jsonKST({ ok: false, error: "전표를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }

    // 예산 항목 정보 (budget_line_id 있을 때)
    let budgetLine: any = null;
    if (voucher.budget_line_id) {
      try {
        const blR: any = await db.execute(sql`
          SELECT bl.id, bl.planned_amount, bl.prev_year_actual, ec.name AS category_name, ec.code AS category_code
          FROM budget_lines bl
          JOIN expense_categories ec ON ec.id = bl.category_id
          WHERE bl.id = ${Number(voucher.budget_line_id)}
          LIMIT 1
        `);
        const bl = (blR?.rows ?? blR ?? [])[0];
        if (bl) {
          budgetLine = {
            id: Number(bl.id),
            categoryName: bl.category_name,
            categoryCode: bl.category_code,
            plannedAmount: Number(bl.planned_amount),
          };
        }
      } catch { /* 보조 조회 실패 무시 */ }
    }

    /* 장부 정보: 보조 조회라 실패해도 머리표로 응답 */
    let ledger: any = { voucherType: "expense", reversalOfId: null, reversedById: null, lines: [], history: [] };
    try {
      const extra: any = await db.execute(sql`
        SELECT voucher_type, reversal_of_id, reversed_by_id, source_type, source_id FROM vouchers WHERE id = ${id}`);
      const row = (extra?.rows ?? extra ?? [])[0];
      const lineRows: any = await db.execute(sql`
        SELECT l.line_no, l.account_code, a.name AS account_name, a.kind, l.debit, l.credit,
               l.function_code, l.program_id, p.name AS program_name, l.fund_id, f.name AS fund_name, l.segment, l.memo
          FROM voucher_lines l
          LEFT JOIN account_codes a ON a.code = l.account_code
          LEFT JOIN ledger_programs p ON p.id = l.program_id
          LEFT JOIN ledger_funds f ON f.id = l.fund_id
         WHERE l.voucher_id = ${id}
         ORDER BY l.line_no`);
      const historyRows: any = await db.execute(sql`
        SELECT action, actor_name, reason, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS at_kst
          FROM ledger_history
         WHERE entity = 'voucher' AND entity_id = ${String(id)}
         ORDER BY id`);
      ledger = {
        voucherType: row?.voucher_type ?? "expense",
        reversalOfId: row?.reversal_of_id == null ? null : Number(row.reversal_of_id),
        reversedById: row?.reversed_by_id == null ? null : Number(row.reversed_by_id),
        sourceType: row?.source_type ?? null,
        sourceId: row?.source_id ?? null,
        lines: (lineRows?.rows ?? lineRows ?? []).map((l: any) => ({
          lineNo: Number(l.line_no), accountCode: l.account_code, accountName: l.account_name, kind: l.kind,
          debit: Number(l.debit), credit: Number(l.credit), functionCode: l.function_code,
          programId: l.program_id == null ? null : Number(l.program_id), programName: l.program_name,
          fundId: l.fund_id == null ? null : Number(l.fund_id), fundName: l.fund_name,
          segment: l.segment, memo: l.memo,
        })),
        history: (historyRows?.rows ?? historyRows ?? []).map((h: any) => ({
          action: h.action, actorName: h.actor_name, reason: h.reason, at: h.at_kst,
        })),
      };
    } catch (err: any) {
      console.warn("[voucher-detail] 장부 정보 조회 실패 (머리표로 계속):", err?.message);
    }

    return new Response(jsonKST({
      ok: true,
      data: {
        voucher: {
          ...ledger,
          id:              Number(voucher.id),
          voucherNumber:   voucher.voucher_number,
          voucherDate:     voucher.voucher_date,
          fiscalYear:      Number(voucher.fiscal_year),
          accountCode:     voucher.account_code,
          accountName:     voucher.account_name,
          subAccount:      voucher.sub_account,
          description:     voucher.description,
          payeeName:       voucher.payee_name,
          amount:          Number(voucher.amount),
          evidenceType:    voucher.evidence_type,
          evidenceNumber:  voucher.evidence_number,
          evidenceUrl:     voucher.evidence_url,
          budgetLineId:    voucher.budget_line_id ? Number(voucher.budget_line_id) : null,
          expenseId:       voucher.expense_id ? Number(voucher.expense_id) : null,
          bankTxnId:       voucher.bank_txn_id ? Number(voucher.bank_txn_id) : null,
          isTemplate:      voucher.is_template,
          templateName:    voucher.template_name,
          status:          voucher.status,
          rejectionReason: voucher.rejection_reason,
          createdBy:       voucher.created_by,
          submittedAt:     isoUTC(voucher.submitted_at),
          approvedBy:      voucher.approved_by,
          approvedAt:      isoUTC(voucher.approved_at),
          createdAt:       isoUTC(voucher.created_at),
          updatedAt:       isoUTC(voucher.updated_at),
        },
        budgetLine,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("select", err);
  }
}
