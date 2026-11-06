/**
 * POST /api/admin-voucher-reverse   { id, date, reason }
 * 승인 전표를 반대 전표로 취소한다. 이사장만 가능하다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ledgerActor, ledgerErrorBody, reverseVoucher } from "../../lib/ledger-post";

export const config = { path: "/api/admin-voucher-reverse" };

const JSON_HEADERS = { "Content-Type": "application/json" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST 메서드만 허용" }), { status: 405, headers: JSON_HEADERS });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if (auth.ctx.member.role !== "super_admin") {
    return new Response(jsonKST({ ok: false, error: "전표 취소는 이사장만 할 수 있습니다" }), { status: 403, headers: JSON_HEADERS });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const id = Number(body?.id) || 0;
  const date = String(body?.date ?? "");
  const reason = String(body?.reason ?? "").trim().slice(0, 300);
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !reason) {
    return new Response(jsonKST({ ok: false, error: "id, date, reason 필수" }), { status: 400, headers: JSON_HEADERS });
  }

  try {
    const result = await db.transaction((tx) =>
      reverseVoucher(tx, id, { date, reason }, ledgerActor(auth), String(auth.ctx.admin.uid)));
    return new Response(jsonKST({
      ok: true,
      data: { ...result, message: `전표를 취소했습니다. 반대 전표 ${result.voucherNumber}` },
    }), { status: 200, headers: JSON_HEADERS });
  } catch (err: any) {
    const { status, body: payload } = ledgerErrorBody("reverse", "전표 취소 실패", err);
    return new Response(jsonKST(payload), { status, headers: JSON_HEADERS });
  }
}
