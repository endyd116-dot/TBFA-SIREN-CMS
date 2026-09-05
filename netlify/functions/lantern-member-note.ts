// netlify/functions/lantern-member-note.ts
// [W3-3] POST /api/lantern-member-note — AM 완료 화면의 「선생님께 한마디」·공개 동의 (서버-서버 · 쿠키 0)
//   헤더: x-am-secret = SIREN_AM_POSTBACK_SECRET
//   body: { memberId(해시), donationId?, note(≤60), publicConsent:boolean } → { ok:true, donationId }
//   donationId가 없으면 그 회원의 등불 캠페인 후원 중 완료 우선·최신 1건에 붙인다.

import { checkAmSecret } from "../../lib/lantern";
import { amSaveNote, AmError } from "../../lib/lantern-am";

export const config = { path: "/api/lantern-member-note" };

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-am-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json({ ok: false, error: "POST만 허용" }, 405);
  if (!checkAmSecret(req)) return json({ ok: false, error: "인증 실패(x-am-secret)", step: "auth" }, 401);

  let body: any = null;
  try { body = await req.json(); } catch { /* noop */ }
  if (!body || typeof body !== "object") return json({ ok: false, error: "요청 본문이 비어있습니다", step: "parse" }, 400);

  try {
    const r = await amSaveNote(body);
    return json({ ok: true, donationId: r.donationId });
  } catch (e: any) {
    if (e instanceof AmError) return json({ ok: false, error: e.message, step: e.step }, e.status);
    console.error("[lantern-member-note]", e);
    return json({ ok: false, error: "저장 중 오류가 발생했습니다", step: "server", detail: String(e?.message || e).slice(0, 300) }, 500);
  }
};
