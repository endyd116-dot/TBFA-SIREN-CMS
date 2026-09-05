// netlify/functions/portone-webhook.ts
// 포트원(PortOne V2) 웹훅 수신 — «사전 준비» 뼈대 (2026-09-06 · 통보문 ⑧ «포트원 준비: 웹훅 수신 코드(키만 비워 둠)»)
//
// POST /api/portone-webhook
//  - 서명 검증: Standard Webhooks(webhook-id · webhook-timestamp · webhook-signature) + 시크릿 PORTONE_WEBHOOK_SECRET
//  - 시크릿이 없으면 503(비활성). 포트원 콘솔에서 웹훅 시크릿을 받아 env에 넣는 순간 켜진다.
//  - 처리: Transaction.Paid → paymentId(=결제 의도 id=pg_order_no) 후원 행을 completed 로 확정 + 캠페인 현황 + 등불 훅(postback·증서)
//          그 외 이벤트(BillingKey.Issued·Transaction.Cancelled 등)는 로그만 남긴다 — 정기 청구·취소 반영은 포트원 API 키 등록 뒤 다음 라운드.
//  ※ 승인 금액 대조·정기 빌링키 저장·월 청구(cron)는 lib/portone(예정)에서 포트원 REST(payments/{id} 조회)로 검증한 뒤 붙인다.

import crypto from "crypto";
import { eq } from "drizzle-orm";
import { yearKST } from "../../lib/kst";
import { db, donations } from "../../db";
import { recalcCampaignStatsSafe } from "../../lib/campaign-stats";
import { afterLanternCompletion } from "../../lib/lantern";
import { logAudit } from "../../lib/audit";

export const config = { path: "/api/portone-webhook" };

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

/** Standard Webhooks 서명 검증 — signedContent = `${id}.${timestamp}.${body}` · HMAC-SHA256(base64) · 허용 시차 5분 */
function verifyStandardWebhook(req: Request, rawBody: string, secret: string): boolean {
  const id = req.headers.get("webhook-id") || "";
  const ts = req.headers.get("webhook-timestamp") || "";
  const sigHeader = req.headers.get("webhook-signature") || "";
  if (!id || !ts || !sigHeader) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) return false;
  const key = secret.startsWith("whsec_") ? Buffer.from(secret.slice(6), "base64") : Buffer.from(secret);
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64");
  return sigHeader.split(" ").some((part) => {
    const [, sig] = part.split(",");
    if (!sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

export default async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST만 허용" }, 405);
  const secret = (process.env.PORTONE_WEBHOOK_SECRET || "").trim();
  if (!secret) return json({ ok: false, error: "포트원 웹훅이 아직 활성화되지 않았습니다(PORTONE_WEBHOOK_SECRET 미설정)" }, 503);

  const raw = await req.text().catch(() => "");
  if (!verifyStandardWebhook(req, raw, secret)) return json({ ok: false, error: "서명 검증 실패" }, 401);

  let evt: any = null;
  try { evt = JSON.parse(raw); } catch { return json({ ok: false, error: "본문 파싱 실패" }, 400); }
  const type = String(evt?.type || "");
  const paymentId = String(evt?.data?.paymentId || "");

  try {
    await logAudit({ userType: "system", action: "portone_webhook", target: paymentId || type, detail: { type, data: evt?.data } } as any);
  } catch { /* noop */ }

  if (type !== "Transaction.Paid" || !paymentId) {
    return json({ ok: true, received: type, handled: false });
  }

  try {
    const [row] = await db.select().from(donations).where(eq(donations.pgOrderNo, paymentId)).limit(1);
    if (!row) return json({ ok: true, handled: false, reason: "주문 없음" });
    if (row.status === "completed") return json({ ok: true, handled: true, dup: true });

    const now = new Date();
    const receiptNumber = `TBFA-${yearKST()}-${String(row.id).padStart(6, "0")}`;
    await db.update(donations).set({
      status: "completed",
      pgProvider: "portone",
      pgTid: String(evt?.data?.transactionId || paymentId).slice(0, 200),
      transactionId: String(evt?.data?.transactionId || paymentId).slice(0, 100),
      receiptIssued: true, receiptIssuedAt: now, receiptNumber, receiptRequested: true,
      paidAt: now, updatedAt: now,
    } as any).where(eq(donations.id, row.id));

    await recalcCampaignStatsSafe((row as any).campaignId);
    const lantern = await afterLanternCompletion({
      donationId: row.id, memberId: row.memberId ?? null, amount: row.amount, monthly: row.type === "regular", paidAt: now,
    });
    return json({ ok: true, handled: true, donationId: row.id, lantern: lantern ? { lanternNo: lantern.lanternNo, postback: lantern.postback } : null });
  } catch (e: any) {
    console.error("[portone-webhook]", e);
    return json({ ok: false, error: "처리 실패", detail: String(e?.message || e).slice(0, 300) }, 500);
  }
};
