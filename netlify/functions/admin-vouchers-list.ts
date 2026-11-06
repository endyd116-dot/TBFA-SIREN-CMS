import { isoUTC, jsonKST, nowKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-vouchers-list" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "전표 목록 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const page      = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit     = Math.min(parseInt(url.searchParams.get("limit") || "30"), 100);
  const offset    = (page - 1) * limit;
  const status    = url.searchParams.get("status") || "";
  const accountCode = url.searchParams.get("accountCode") || "";
  const budgetLineId = parseInt(url.searchParams.get("budgetLineId") || "0");
  const isTemplate = url.searchParams.get("isTemplate");
  const startDate = url.searchParams.get("startDate") || "";
  const endDate   = url.searchParams.get("endDate") || "";
  const fiscalYear = parseInt(url.searchParams.get("fiscalYear") || "0");

  // 기간 결정
  let dateStart: string;
  let dateEnd: string;
  if (fiscalYear) {
    dateStart = `${fiscalYear}-01-01`;
    dateEnd   = `${fiscalYear}-12-31`;
  } else if (startDate && endDate) {
    dateStart = startDate;
    dateEnd   = endDate;
  } else {
    const now = new Date();
    dateStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    dateEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  }

  try {
    const rows: any = await db.execute(sql`
      SELECT
        v.id, v.voucher_number, v.voucher_date, v.fiscal_year,
        v.account_code, v.account_name, v.sub_account,
        v.description, v.payee_name, v.amount,
        v.evidence_type, v.budget_line_id,
        v.is_template, v.template_name,
        v.status, v.rejection_reason,
        v.created_by, v.submitted_at, v.approved_by, v.approved_at,
        v.created_at, v.updated_at
      FROM vouchers v
      WHERE v.voucher_date BETWEEN ${dateStart} AND ${dateEnd}
        AND (${status} = '' OR ${status} = 'all' OR v.status = ${status})
        AND (${accountCode} = '' OR v.account_code = ${accountCode})
        AND (${budgetLineId} = 0 OR v.budget_line_id = ${budgetLineId})
        AND (${isTemplate}::text IS NULL OR v.is_template = ${isTemplate === "true"})
      ORDER BY v.voucher_date DESC, v.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    let total = 0;
    try {
      const cnt: any = await db.execute(sql`
        SELECT COUNT(*) AS n FROM vouchers v
        WHERE v.voucher_date BETWEEN ${dateStart} AND ${dateEnd}
          AND (${status} = '' OR ${status} = 'all' OR v.status = ${status})
          AND (${accountCode} = '' OR v.account_code = ${accountCode})
          AND (${budgetLineId} = 0 OR v.budget_line_id = ${budgetLineId})
          AND (${isTemplate}::text IS NULL OR v.is_template = ${isTemplate === "true"})
      `);
      total = Number((cnt?.rows ?? cnt ?? [])[0]?.n ?? 0);
    } catch { /* 카운트 실패 무시 */ }

    const vouchers = (rows?.rows ?? rows ?? []).map((r: any) => ({
      id:             Number(r.id),
      voucherNumber:  r.voucher_number,
      voucherDate:    r.voucher_date,
      fiscalYear:     Number(r.fiscal_year),
      accountCode:    r.account_code,
      accountName:    r.account_name,
      subAccount:     r.sub_account,
      description:    r.description,
      payeeName:      r.payee_name,
      amount:         Number(r.amount),
      evidenceType:   r.evidence_type,
      budgetLineId:   r.budget_line_id ? Number(r.budget_line_id) : null,
      isTemplate:     r.is_template,
      templateName:   r.template_name,
      status:         r.status,
      rejectionReason: r.rejection_reason,
      createdBy:      r.created_by,
      submittedAt:    isoUTC(r.submitted_at),
      approvedBy:     r.approved_by,
      approvedAt:     isoUTC(r.approved_at),
      createdAt:      isoUTC(r.created_at),
      updatedAt:      isoUTC(r.updated_at),
      voucherType:    "expense" as string,
      reversedById:   null as number | null,
      reversalOfId:   null as number | null,
    }));

    /* 장부 컬럼은 보조 조회로 합친다 */
    if (vouchers.length) {
      try {
        const ids = vouchers.map((v: any) => v.id);
        const extra: any = await db.execute(sql`
          SELECT id, voucher_type, reversed_by_id, reversal_of_id FROM vouchers
           WHERE id IN (${sql.join(ids.map((n: number) => sql`${n}`), sql`, `)})`);
        const byId = new Map((extra?.rows ?? extra ?? []).map((r: any) => [Number(r.id), r]));
        for (const v of vouchers) {
          const r: any = byId.get(v.id);
          if (!r) continue;
          v.voucherType = r.voucher_type;
          v.reversedById = r.reversed_by_id == null ? null : Number(r.reversed_by_id);
          v.reversalOfId = r.reversal_of_id == null ? null : Number(r.reversal_of_id);
        }
      } catch (err: any) {
        console.warn("[vouchers-list] 장부 컬럼 조회 실패 (기본값으로 계속):", err?.message);
      }
    }

    return new Response(jsonKST({
      ok: true,
      data: { vouchers, total, page, limit, dateStart, dateEnd },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("select", err);
  }
}
