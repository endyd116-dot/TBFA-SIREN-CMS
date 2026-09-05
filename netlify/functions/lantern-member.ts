// netlify/functions/lantern-member.ts
// [W3-1] POST /api/lantern-member — AutoMarketing 랜딩 모달의 «후원회원 가입» (서버-서버 · 쿠키 0)
//
// 헤더: x-am-secret = SIREN_AM_POSTBACK_SECRET
// body: { campaignSlug:"등불의-기적", name, phone, email, school?, consents:{bylaws,privacy,sms},
//         consentText:{bylaws,privacy}, consentAt:ISO, ip, ua, am_lp, am_anon?, gate? }
// → { ok:true, memberId(해시 24자), status:"new"|"existing" } · 4xx { ok:false, error, step }

import { checkAmSecret } from "../../lib/lantern";
import { amUpsertMember, AmError } from "../../lib/lantern-am";

export const config = { path: "/api/lantern-member" };

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
    const r = await amUpsertMember(body);
    return json({ ok: true, memberId: r.memberId, status: r.status });
  } catch (e: any) {
    if (e instanceof AmError) return json({ ok: false, error: e.message, step: e.step }, e.status);
    console.error("[lantern-member]", e);
    return json({ ok: false, error: "가입 처리 중 오류가 발생했습니다", step: "server", detail: String(e?.message || e).slice(0, 300) }, 500);
  }
};
