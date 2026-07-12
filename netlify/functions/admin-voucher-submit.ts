import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sendEmail } from "../../lib/email";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-voucher-submit" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "전표 제출 실패", step,
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

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { id } = body;
  if (!id) {
    return new Response(jsonKST({ ok: false, error: "id 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  let voucher: any;
  try {
    const rows: any = await db.execute(sql`
      SELECT id, status, voucher_number, description, amount, account_name
      FROM vouchers WHERE id = ${Number(id)} LIMIT 1
    `);
    voucher = (rows?.rows ?? rows ?? [])[0];
    if (!voucher) {
      return new Response(jsonKST({ ok: false, error: "전표를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (voucher.status !== "draft" && voucher.status !== "rejected") {
      return new Response(jsonKST({ ok: false, error: `draft 또는 rejected 상태에서만 제출 가능 (현재: ${voucher.status})` }),
        { status: 422, headers: { "Content-Type": "application/json" } });
    }
  } catch (err: any) {
    return jsonError("select", err);
  }

  try {
    await db.execute(sql`
      UPDATE vouchers
      SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
      WHERE id = ${Number(id)}
    `);
  } catch (err: any) {
    return jsonError("update", err);
  }

  // 승인 담당자 이메일 알림 (fire-and-forget)
  const notifyEmail = process.env.ADMIN_NOTIFY_EMAIL;
  if (notifyEmail) {
    sendEmail({
      to: notifyEmail,
      subject: `[SIREN] 전표 승인 요청 — ${voucher.voucher_number}`,
      html: `
        <p>전표 승인 요청이 접수되었습니다.</p>
        <ul>
          <li>전표번호: <strong>${voucher.voucher_number}</strong></li>
          <li>계정과목: ${voucher.account_name}</li>
          <li>적요: ${voucher.description}</li>
          <li>금액: ${Number(voucher.amount).toLocaleString("ko-KR")}원</li>
        </ul>
        <p>SIREN 관리자 화면에서 승인해주세요.</p>
      `,
    }).catch((e) => console.error("[voucher-submit] 이메일 발송 실패:", e));
  }

  return new Response(jsonKST({
    ok: true,
    data: { message: `전표 ${voucher.voucher_number}이 제출되었습니다. 승인 담당자 검토 대기 중입니다.` },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}
