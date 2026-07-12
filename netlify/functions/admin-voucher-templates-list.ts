import { isoUTC } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-voucher-templates-list" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  try {
    const rows: any = await db.execute(sql`
      SELECT
        id, voucher_number, account_code, account_name, sub_account,
        description, payee_name, amount, evidence_type, budget_line_id,
        template_name, created_by, created_at
      FROM vouchers
      WHERE is_template = TRUE
      ORDER BY template_name, created_at DESC
    `);

    const templates = (rows?.rows ?? rows ?? []).map((r: any) => ({
      id:           Number(r.id),
      voucherNumber: r.voucher_number,
      accountCode:  r.account_code,
      accountName:  r.account_name,
      subAccount:   r.sub_account,
      description:  r.description,
      payeeName:    r.payee_name,
      amount:       Number(r.amount),
      evidenceType: r.evidence_type,
      budgetLineId: r.budget_line_id ? Number(r.budget_line_id) : null,
      templateName: r.template_name,
      createdBy:    r.created_by,
      createdAt:    isoUTC(r.created_at),
    }));

    return new Response(
      JSON.stringify({ ok: true, data: { templates, total: templates.length } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "전표 템플릿 목록 조회 실패", step: "select",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
