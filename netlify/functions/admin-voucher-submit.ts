import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ledgerActor, ledgerErrorBody, prepareSubmit, recordHistory } from "../../lib/ledger-post";
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

  /* 줄 없는 전표는 기본 2줄을 만들고, 빠진 항목이 있으면 제출을 막는다 */
  let voucher: any;
  try {
    voucher = await db.transaction(async (tx) => {
      const v = await prepareSubmit(tx, Number(id));
      await tx.execute(sql`
        UPDATE vouchers
        SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
        WHERE id = ${Number(id)}
      `);
      await recordHistory(tx, {
        entity: "voucher", entityId: Number(id), action: "submitted", actor: ledgerActor(auth),
      });
      return v;
    });
  } catch (err: any) {
    const { status, body: payload } = ledgerErrorBody("submit", "전표 제출 실패", err);
    return new Response(jsonKST(payload), { status, headers: { "Content-Type": "application/json" } });
  }

  // 승인 담당자 이메일 알림. 함수가 먼저 끝나면 발송이 유실되므로 기다린다
  const notifyEmail = process.env.ADMIN_NOTIFY_EMAIL;
  if (notifyEmail) {
    await sendEmail({
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
