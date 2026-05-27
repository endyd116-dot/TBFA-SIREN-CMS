import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-voucher-approve" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "전표 승인/반려 실패", step,
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

  // super_admin만 승인/반려 가능
  if (auth.ctx.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "super_admin 권한이 필요합니다" }),
      { status: 403, headers: { "Content-Type": "application/json" } });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { id, action, rejectionReason } = body;
  if (!id || !action) {
    return new Response(JSON.stringify({ ok: false, error: "id, action 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (action === "reject" && !rejectionReason?.trim()) {
    return new Response(JSON.stringify({ ok: false, error: "반려 사유 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  let voucher: any;
  try {
    const rows: any = await db.execute(sql`
      SELECT id, status, voucher_number FROM vouchers WHERE id = ${Number(id)} LIMIT 1
    `);
    voucher = (rows?.rows ?? rows ?? [])[0];
    if (!voucher) {
      return new Response(JSON.stringify({ ok: false, error: "전표를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (voucher.status !== "submitted") {
      return new Response(JSON.stringify({ ok: false, error: `submitted 상태에서만 승인/반려 가능 (현재: ${voucher.status})` }),
        { status: 422, headers: { "Content-Type": "application/json" } });
    }
  } catch (err: any) {
    return jsonError("select", err);
  }

  /* Q4-026: approved_by에 회원 id 저장(타 재정 테이블 expense/revenue/budget과 형식 통일).
     이전엔 이메일 문자열을 저장해 감사 필드 형식이 테이블마다 섞였음. */
  const approverUid = String(auth.ctx.admin.uid);
  const label = action === "approve" ? "승인" : "반려";

  try {
    if (action === "approve") {
      await db.execute(sql`
        UPDATE vouchers
        SET status = 'approved',
            approved_by = ${approverUid},
            approved_at = NOW(),
            updated_at = NOW()
        WHERE id = ${Number(id)}
      `);
    } else {
      await db.execute(sql`
        UPDATE vouchers
        SET status = 'rejected',
            approved_by = ${approverUid},
            approved_at = NOW(),
            rejection_reason = ${rejectionReason.trim()},
            updated_at = NOW()
        WHERE id = ${Number(id)}
      `);
    }

    return new Response(JSON.stringify({
      ok: true,
      data: { message: `전표 ${voucher.voucher_number}이 ${label}되었습니다.` },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError(label, err);
  }
}
