import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import {
  VOUCHER_TYPES, ledgerActor, ledgerErrorBody, normalizeLines, recordHistory, saveLines, validateLines,
} from "../../lib/ledger-post";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-voucher-update" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "전표 수정 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "PUT") {
    return new Response(jsonKST({ ok: false, error: "PUT 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const {
    id, voucherDate, accountCode, subAccount, description,
    payeeName, amount, evidenceType, evidenceNumber, evidenceUrl,
    budgetLineId, isTemplate, templateName,
  } = body;

  /* lines가 오면 분개를 통째로 교체한다. 빈 배열이면 분개를 비운다. */
  const hasLinesField = Array.isArray(body.lines);
  const lines = normalizeLines(body.lines);
  const voucherType = VOUCHER_TYPES.includes(body.voucherType) && body.voucherType !== "reversal"
    ? String(body.voucherType) : null;

  if (!id) {
    return new Response(jsonKST({ ok: false, error: "id 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // draft 또는 rejected 상태 체크
  let voucher: any;
  try {
    const rows: any = await db.execute(sql`
      SELECT id, status, voucher_number FROM vouchers WHERE id = ${Number(id)} LIMIT 1
    `);
    voucher = (rows?.rows ?? rows ?? [])[0];
    if (!voucher) {
      return new Response(jsonKST({ ok: false, error: "전표를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (voucher.status !== "draft" && voucher.status !== "rejected") {
      return new Response(jsonKST({ ok: false, error: `draft 또는 rejected 상태에서만 수정 가능 (현재: ${voucher.status})` }),
        { status: 422, headers: { "Content-Type": "application/json" } });
    }
  } catch (err: any) {
    return jsonError("select", err);
  }

  // 계정과목 변경 시 이름 재조회
  let accountName: string | null = null;
  if (accountCode) {
    try {
      const acR: any = await db.execute(sql`
        SELECT name FROM account_codes WHERE code = ${accountCode} AND is_active = TRUE LIMIT 1
      `);
      const ac = (acR?.rows ?? acR ?? [])[0];
      if (!ac) {
        return new Response(jsonKST({ ok: false, error: `존재하지 않는 계정과목 코드: ${accountCode}` }),
          { status: 422, headers: { "Content-Type": "application/json" } });
      }
      accountName = ac.name;
    } catch (err: any) {
      return jsonError("select_account_code", err);
    }
  }

  if (lines.length) {
    try {
      const problems = await validateLines(db, { voucherDate: String(voucherDate || ""), lines, strict: false });
      if (problems.length) {
        return new Response(jsonKST({ ok: false, error: "분개를 확인하세요", missing: problems }),
          { status: 422, headers: { "Content-Type": "application/json" } });
      }
    } catch (err: any) {
      return jsonError("validate_lines", err);
    }
  }

  try {
    await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE vouchers SET
        voucher_date    = COALESCE(${voucherDate || null}, voucher_date),
        fiscal_year     = EXTRACT(YEAR FROM COALESCE(${voucherDate || null}::date, voucher_date))::int,
        account_code    = COALESCE(${accountCode || null}, account_code),
        account_name    = COALESCE(${accountName}, account_name),
        sub_account     = ${subAccount !== undefined ? (subAccount || null) : sql`sub_account`},
        description     = COALESCE(${description || null}, description),
        payee_name      = ${payeeName !== undefined ? (payeeName || null) : sql`payee_name`},
        amount          = COALESCE(${amount !== undefined ? Number(amount) : null}, amount),
        evidence_type   = COALESCE(${evidenceType || null}, evidence_type),
        evidence_number = ${evidenceNumber !== undefined ? (evidenceNumber || null) : sql`evidence_number`},
        evidence_url    = ${evidenceUrl !== undefined ? (evidenceUrl || null) : sql`evidence_url`},
        budget_line_id  = ${budgetLineId !== undefined ? (budgetLineId ? Number(budgetLineId) : null) : sql`budget_line_id`},
        is_template     = COALESCE(${isTemplate !== undefined ? Boolean(isTemplate) : null}, is_template),
        template_name   = ${templateName !== undefined ? (templateName || null) : sql`template_name`},
        status          = 'draft',
        rejection_reason = NULL,
        updated_at      = NOW()
      WHERE id = ${Number(id)} AND status IN ('draft','rejected')
    `);
    if (voucherType) {
      await tx.execute(sql`UPDATE vouchers SET voucher_type = ${voucherType} WHERE id = ${Number(id)}`);
    }
    if (hasLinesField) {
      await saveLines(tx, Number(id), lines);
      await recordHistory(tx, {
        entity: "voucher", entityId: Number(id), action: "updated", actor: ledgerActor(auth),
        after: { voucherNumber: voucher.voucher_number, voucherType, lines },
      });
    }
    });

    return new Response(jsonKST({
      ok: true,
      data: { message: `전표 ${voucher.voucher_number}이 수정되었습니다.` },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    const { status, body: payload } = ledgerErrorBody("update", "전표 수정 실패", err);
    return new Response(jsonKST(payload), { status, headers: { "Content-Type": "application/json" } });
  }
}
