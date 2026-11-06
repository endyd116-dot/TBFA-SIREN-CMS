import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ledgerActor, recordHistory } from "../../lib/ledger-post";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-voucher-delete" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "전표 삭제 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "DELETE") {
    return new Response(jsonKST({ ok: false, error: "DELETE 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0");
  if (!id) {
    return new Response(jsonKST({ ok: false, error: "id 파라미터 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const rows: any = await db.execute(sql`
      SELECT id, status, voucher_number, created_by, voucher_date, description, amount FROM vouchers WHERE id = ${id} LIMIT 1
    `);
    const voucher = (rows?.rows ?? rows ?? [])[0];
    if (!voucher) {
      return new Response(jsonKST({ ok: false, error: "전표를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (voucher.status !== "draft") {
      return new Response(jsonKST({ ok: false, error: `draft 상태에서만 삭제 가능 (현재: ${voucher.status})` }),
        { status: 422, headers: { "Content-Type": "application/json" } });
    }

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE bank_transactions
           SET voucher_id = NULL, status = 'pending', match_type = 'pending',
               admin_account_code = NULL, admin_budget_id = NULL, confirmed_by = NULL, confirmed_at = NULL
         WHERE voucher_id = ${id}`);
      await tx.execute(sql`DELETE FROM vouchers WHERE id = ${id}`);
      /* 작성 기록이 남아 있으므로 삭제도 남긴다. 전표가 사라져도 이력으로 추적한다 */
      await recordHistory(tx, {
        entity: "voucher", entityId: id, action: "deleted", actor: ledgerActor(auth),
        before: {
          voucherNumber: voucher.voucher_number, voucherDate: voucher.voucher_date,
          description: voucher.description, amount: Number(voucher.amount),
        },
      });
    });

    return new Response(jsonKST({
      ok: true,
      data: { message: `전표 ${voucher.voucher_number}이 삭제되었습니다.` },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("delete", err);
  }
}
