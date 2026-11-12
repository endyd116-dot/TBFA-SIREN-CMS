// netlify/functions/lantern-payment-intent.ts
// [W3-2] POST /api/lantern-payment-intent — AutoMarketing 랜딩 모달의 결제 의도 (서버-서버 · 쿠키 0)
//   헤더: x-am-secret = SIREN_AM_POSTBACK_SECRET
//   body: { memberId(해시), amount, monthly, method:"card"|"easy"|"transfer"|"cms"|"bank", am_lp, am_anon?, gate? }
//   → 계좌 직접 입금: { ok:true, intentId, provider:"manual", bankAccount:{bank,number,holder,guideText} }
//   → 효성(정기 계좌 자동이체): { ok:true, intentId, provider:"hyosung", redirectUrl }
//   → KICC 단계: { ok:true, intentId, provider:"kicc", redirectUrl }   // 회원·금액 미리 채워진 SIREN 결제 페이지
//   → 포트원 단계: { ok:true, intentId, provider:"portone", payload }  // SDK v2 인자 그대로(PORTONE_* env 등록 시 자동 스위치)
//   ※ 2026-11-12 «카드 결제 받기» 꺼짐(기본 · /api/donation-policy 의 cardEnabled=false):
//     정기(monthly:true)는 "cms"만, 일시는 "bank"만 받는다. card·easy·transfer →
//     400 { ok:false, error:"지금은 카드 결제를 받지 않습니다. 계좌 자동이체(효성 CMS) 또는 계좌이체를 이용해 주세요.", step:"card_disabled" }
//
// GET /api/lantern-payment-intent?intent=<id> — 결제 페이지용 공개 요약(개인정보 0 · 이름 마스킹)

import { checkAmSecret } from "../../lib/lantern";
import { amCreateIntent, amIntentSummary, AmError } from "../../lib/lantern-am";

export const config = { path: "/api/lantern-payment-intent" };

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-am-secret", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } });

  if (req.method === "GET") {
    const url = new URL(req.url);
    const intent = String(url.searchParams.get("intent") || "").trim();
    try {
      const s = await amIntentSummary(intent);
      return json({ ok: true, ...s });
    } catch (e: any) {
      if (e instanceof AmError) return json({ ok: false, error: e.message, step: e.step }, e.status);
      console.error("[lantern-payment-intent GET]", e);
      return json({ ok: false, error: "조회 중 오류가 발생했습니다", step: "server" }, 500);
    }
  }

  if (req.method !== "POST") return json({ ok: false, error: "GET/POST만 허용" }, 405);
  if (!checkAmSecret(req)) return json({ ok: false, error: "인증 실패(x-am-secret)", step: "auth" }, 401);

  let body: any = null;
  try { body = await req.json(); } catch { /* noop */ }
  if (!body || typeof body !== "object") return json({ ok: false, error: "요청 본문이 비어있습니다", step: "parse" }, 400);

  try {
    const r = await amCreateIntent(body);
    const out: any = { ok: true, intentId: r.intentId, provider: r.provider, donationId: r.donationId };
    if (r.redirectUrl) out.redirectUrl = r.redirectUrl;
    if (r.payload) out.payload = r.payload;
    if (r.bankAccount) out.bankAccount = r.bankAccount;
    return json(out);
  } catch (e: any) {
    if (e instanceof AmError) return json({ ok: false, error: e.message, step: e.step }, e.status);
    console.error("[lantern-payment-intent]", e);
    return json({ ok: false, error: "결제 의도 처리 중 오류가 발생했습니다", step: "server", detail: String(e?.message || e).slice(0, 300) }, 500);
  }
};
