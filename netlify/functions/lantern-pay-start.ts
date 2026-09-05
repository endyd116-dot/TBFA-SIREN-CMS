// netlify/functions/lantern-pay-start.ts
// POST /api/lantern-pay-start { intentId } — 미리 채워진 결제 페이지(lantern-pay.html)에서 KICC 결제창 주소 발급
//   intentId(32 hex 무작위)가 곧 열쇠라 로그인·쿠키 없이 쓴다. 정기면 빌키 등록창, 일시면 통합 결제창.
//   KICC 복귀는 기존 billing-approve / donate-kicc-approve 가 처리하고, 완료 화면 → 랜딩(?lit=1&…&intent=) 으로 돌아간다.

import { amStartKiccPayment, AmError } from "../../lib/lantern-am";

export const config = { path: "/api/lantern-pay-start" };

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return json({ ok: false, error: "POST만 허용" }, 405);
  let body: any = null;
  try { body = await req.json(); } catch { /* noop */ }
  const intentId = String(body?.intentId || body?.intent || "").trim();
  try {
    const r = await amStartKiccPayment(intentId);
    return json({ ok: true, authPageUrl: r.authPageUrl });
  } catch (e: any) {
    if (e instanceof AmError) return json({ ok: false, error: e.message, step: e.step }, e.status);
    console.error("[lantern-pay-start]", e);
    return json({ ok: false, error: "결제 준비 중 오류가 발생했습니다", step: "server", detail: String(e?.message || e).slice(0, 300) }, 500);
  }
};
