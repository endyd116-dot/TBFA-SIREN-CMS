/**
 * POST /api/admin-bank-transaction-match
 * 수동 매칭 — 거래를 기존 donations·other_revenues·voucher에 직접 연결
 *
 * Body: {
 *   transactionId: number,
 *   matchTo: 'donation' | 'revenue' | 'voucher',
 *   targetId: number          연결할 donations.id / other_revenues.id / vouchers.id
 * }
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-bank-transaction-match" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "수동 매칭 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const adminEmail = String(auth.ctx.member?.email || auth.ctx.admin?.uid || "admin");

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const { transactionId, matchTo, targetId } = body;

  if (!transactionId || !["donation", "revenue", "voucher"].includes(matchTo) || !targetId) {
    return new Response(JSON.stringify({
      ok: false, error: "transactionId, matchTo(donation|revenue|voucher), targetId 필수",
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // ── 거래 존재 확인 ─────────────────────────────────────────
  let txn: any;
  try {
    const r: any = await db.execute(sql`
      SELECT id, txn_type FROM bank_transactions WHERE id = ${Number(transactionId)} LIMIT 1`);
    txn = (r?.rows ?? r ?? [])[0];
  } catch (err: any) {
    return jsonError("select_txn", err);
  }
  if (!txn) {
    return new Response(JSON.stringify({ ok: false, error: "거래를 찾을 수 없음" }),
      { status: 404, headers: { "Content-Type": "application/json" } });
  }

  // ── 대상 존재 확인 ─────────────────────────────────────────
  const tid = Number(targetId);
  try {
    let exists: any;
    if (matchTo === "donation") {
      exists = await db.execute(sql`SELECT id FROM donations WHERE id = ${tid} LIMIT 1`);
    } else if (matchTo === "revenue") {
      exists = await db.execute(sql`SELECT id FROM other_revenues WHERE id = ${tid} LIMIT 1`);
    } else {
      exists = await db.execute(sql`SELECT id FROM vouchers WHERE id = ${tid} LIMIT 1`);
    }
    if ((exists?.rows ?? exists ?? []).length === 0) {
      return new Response(JSON.stringify({ ok: false, error: `대상 ${matchTo} #${tid}를 찾을 수 없음` }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
  } catch (err: any) {
    return jsonError("select_target", err);
  }

  // ── 매칭 적용 ──────────────────────────────────────────────
  try {
    if (matchTo === "donation") {
      await db.execute(sql`
        UPDATE bank_transactions SET
          match_type = 'donation', status = 'confirmed',
          donation_id = ${tid}, other_revenue_id = NULL, voucher_id = NULL,
          confirmed_at = NOW(), confirmed_by = ${adminEmail}
        WHERE id = ${txn.id}`);
    } else if (matchTo === "revenue") {
      await db.execute(sql`
        UPDATE bank_transactions SET
          match_type = 'revenue', status = 'confirmed',
          other_revenue_id = ${tid}, donation_id = NULL, voucher_id = NULL,
          confirmed_at = NOW(), confirmed_by = ${adminEmail}
        WHERE id = ${txn.id}`);
    } else {
      await db.execute(sql`
        UPDATE bank_transactions SET
          match_type = 'voucher', status = 'voucher_created',
          voucher_id = ${tid}, donation_id = NULL, other_revenue_id = NULL,
          confirmed_at = NOW(), confirmed_by = ${adminEmail}
        WHERE id = ${txn.id}`);
    }
  } catch (err: any) {
    return jsonError("update_match", err);
  }

  return new Response(JSON.stringify({
    ok: true,
    data: {
      transactionId: Number(txn.id),
      matchTo, targetId: tid,
      message: `거래 #${txn.id}를 ${matchTo} #${tid}에 수동 매칭했습니다`,
    },
  }), { headers: { "Content-Type": "application/json" } });
}
