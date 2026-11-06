import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ledgerActor, ledgerErrorBody, postVoucher, rejectVoucher } from "../../lib/ledger-post";

export const config = { path: "/api/admin-voucher-approve" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  // super_admin만 승인/반려 가능
  if (auth.ctx.member.role !== "super_admin") {
    return new Response(jsonKST({ ok: false, error: "super_admin 권한이 필요합니다" }),
      { status: 403, headers: { "Content-Type": "application/json" } });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { id, action, rejectionReason } = body;
  if (!id || !action) {
    return new Response(jsonKST({ ok: false, error: "id, action 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (action === "reject" && !rejectionReason?.trim()) {
    return new Response(jsonKST({ ok: false, error: "반려 사유 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  /* Q4-026: approved_by에 회원 id 저장(타 재정 테이블 expense/revenue/budget과 형식 통일).
     이전엔 이메일 문자열을 저장해 감사 필드 형식이 테이블마다 섞였음. */
  const approverUid = String(auth.ctx.admin.uid);
  const label = action === "approve" ? "승인" : "반려";
  const actor = ledgerActor(auth);

  try {
    const voucher = await db.transaction((tx) => action === "approve"
      ? postVoucher(tx, Number(id), actor, approverUid)
      : rejectVoucher(tx, Number(id), rejectionReason.trim(), actor, approverUid));

    return new Response(jsonKST({
      ok: true,
      data: { message: `전표 ${voucher.voucher_number}이 ${label}되었습니다.` },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    const { status, body: payload } = ledgerErrorBody(label, `전표 ${label} 실패`, err);
    return new Response(jsonKST(payload), { status, headers: { "Content-Type": "application/json" } });
  }
}
