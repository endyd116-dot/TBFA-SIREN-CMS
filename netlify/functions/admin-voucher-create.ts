import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { nextVoucherNumber } from "../../lib/voucher-number";
import {
  VOUCHER_TYPES, headerFromLines, ledgerActor, ledgerErrorBody, loadAccounts, normalizeLines,
  recordHistory, saveLines, validateLines,
} from "../../lib/ledger-post";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-voucher-create" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "전표 작성 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const adminId = auth.ctx.admin.uid;
  const memberUid = auth.ctx.member.email;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const {
    voucherDate, subAccount, description,
    payeeName, evidenceType, evidenceNumber, evidenceUrl,
    budgetLineId, expenseId, isTemplate, templateName,
  } = body;
  let { accountCode, amount } = body;

  /* 복식 입력: 분개 줄이 오면 대표 계정과 금액은 줄에서 계산한다 */
  const lines = normalizeLines(body.lines);
  const voucherType = VOUCHER_TYPES.includes(body.voucherType) && body.voucherType !== "reversal"
    ? String(body.voucherType) : null;

  if (!voucherDate || !description || (!lines.length && (!accountCode || amount === undefined))) {
    return new Response(jsonKST({ ok: false, error: "voucherDate, description, 그리고 분개 또는 accountCode·amount가 필요합니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  if (lines.length) {
    try {
      const problems = await validateLines(db, { voucherDate: String(voucherDate), lines, strict: false });
      if (problems.length) {
        return new Response(jsonKST({ ok: false, error: "분개를 확인하세요", missing: problems }),
          { status: 422, headers: { "Content-Type": "application/json" } });
      }
      const header = headerFromLines(lines, await loadAccounts(db, lines.map((l) => l.accountCode)));
      accountCode = header.accountCode;
      amount = header.amount;
    } catch (err: any) {
      return jsonError("validate_lines", err);
    }
  }

  // 계정과목 존재 확인
  let accountName = accountCode;
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

  // voucher_number 자동 생성: YYYYMM-NNN
  // Q4-024: 발번(MAX+1)과 INSERT를 한 트랜잭션 + advisory lock으로 묶어 동시 발번 충돌 방지.
  const yyyymm = String(voucherDate).slice(0, 7).replace("-", "");
  const fiscalYear = parseInt(String(voucherDate).slice(0, 4));
  const createdBy = String(memberUid || adminId);

  try {
    const created = await db.transaction(async (tx) => {
      const voucherNumber = await nextVoucherNumber(tx, yyyymm);
      const result: any = await tx.execute(sql`
        INSERT INTO vouchers (
          voucher_number, voucher_date, fiscal_year,
          account_code, account_name, sub_account,
          description, payee_name, amount,
          evidence_type, evidence_number, evidence_url,
          budget_line_id, expense_id,
          is_template, template_name,
          status, created_by, created_at, updated_at
        ) VALUES (
          ${voucherNumber}, ${voucherDate}, ${fiscalYear},
          ${accountCode}, ${accountName}, ${subAccount || null},
          ${description}, ${payeeName || null}, ${Number(amount)},
          ${evidenceType || "none"}, ${evidenceNumber || null}, ${evidenceUrl || null},
          ${budgetLineId ? Number(budgetLineId) : null}, ${expenseId ? Number(expenseId) : null},
          ${Boolean(isTemplate)}, ${templateName || null},
          'draft', ${createdBy}, NOW(), NOW()
        ) RETURNING id, voucher_number
      `);
      const row = (result?.rows ?? result ?? [])[0];
      const newId = Number(row.id);
      if (voucherType) {
        await tx.execute(sql`UPDATE vouchers SET voucher_type = ${voucherType} WHERE id = ${newId}`);
      }
      if (lines.length) {
        await saveLines(tx, newId, lines);
        await recordHistory(tx, {
          entity: "voucher", entityId: newId, action: "created", actor: ledgerActor(auth),
          after: { voucherNumber: row.voucher_number, voucherType, lines },
        });
      }
      return row;
    });

    return new Response(jsonKST({
      ok: true,
      data: {
        voucherId: Number(created.id),
        voucherNumber: created.voucher_number,
        message: `전표가 작성되었습니다. 번호: ${created.voucher_number}`,
      },
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    const { status, body: payload } = ledgerErrorBody("insert", "전표 작성 실패", err);
    return new Response(jsonKST(payload), { status, headers: { "Content-Type": "application/json" } });
  }
}
