/**
 * /api/unsubscribe — 수신거부 / 재동의 (로그인 불필요·토큰 서명 게이트)
 *
 * GET  ?t=token        : 현재 수신 상태 조회 (페이지 렌더용)
 * POST {t, action}     : action='off'(수신거부) | 'on'(다시 받기)
 *   channel별: email→agree_email / sms→agree_sms / kakao→kakao_marketing_consent_at
 *
 * 토큰(HMAC 서명)으로 본인만 변경 가능. 잘못 눌러도 같은 화면에서 'on'으로 즉시 재동의.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { verifyUnsubToken } from "../../lib/unsubscribe-token";

export const config = { path: "/api/unsubscribe" };
const H = { "Content-Type": "application/json; charset=utf-8" };

const CH_LABEL: Record<string, string> = { email: "이메일", sms: "문자(SMS)", kakao: "카카오 알림톡" };

async function currentState(memberId: number, channel: string): Promise<{ subscribed: boolean; name: string } | null> {
  const r: any = await db.execute(sql`
    SELECT name, agree_email, agree_sms, kakao_marketing_consent_at
      FROM members WHERE id = ${memberId} LIMIT 1`);
  const m = (r?.rows ?? r ?? [])[0];
  if (!m) return null;
  let subscribed = true;
  if (channel === "email") subscribed = m.agree_email !== false;
  else if (channel === "sms") subscribed = m.agree_sms !== false;
  else if (channel === "kakao") subscribed = !!m.kakao_marketing_consent_at;
  return { subscribed, name: String(m.name || "") };
}

export default async function handler(req: Request) {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const tok = verifyUnsubToken(url.searchParams.get("t") || "");
    if (!tok) return new Response(JSON.stringify({ ok: false, error: "유효하지 않은 링크입니다" }), { status: 400, headers: H });
    const st = await currentState(tok.memberId, tok.channel);
    if (!st) return new Response(JSON.stringify({ ok: false, error: "수신자를 찾을 수 없습니다" }), { status: 404, headers: H });
    return new Response(JSON.stringify({ ok: true, channel: tok.channel, channelLabel: CH_LABEL[tok.channel] || tok.channel, subscribed: st.subscribed, name: st.name }), { status: 200, headers: H });
  }

  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false }), { status: 405, headers: H });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const tok = verifyUnsubToken(String(body?.t || ""));
  if (!tok) return new Response(JSON.stringify({ ok: false, error: "유효하지 않은 링크입니다" }), { status: 400, headers: H });
  const action = body?.action === "on" ? "on" : "off";
  const subscribe = action === "on";

  try {
    if (tok.channel === "email") {
      await db.execute(sql`UPDATE members SET agree_email = ${subscribe}, updated_at = NOW() WHERE id = ${tok.memberId}`);
    } else if (tok.channel === "sms") {
      await db.execute(sql`UPDATE members SET agree_sms = ${subscribe}, updated_at = NOW() WHERE id = ${tok.memberId}`);
    } else if (tok.channel === "kakao") {
      await db.execute(sql`UPDATE members SET kakao_marketing_consent_at = ${subscribe ? sql`NOW()` : sql`NULL`}, updated_at = NOW() WHERE id = ${tok.memberId}`);
    }
    return new Response(JSON.stringify({ ok: true, channel: tok.channel, channelLabel: CH_LABEL[tok.channel] || tok.channel, subscribed: subscribe }), { status: 200, headers: H });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: "처리 실패", detail: String(err?.message || err).slice(0, 300) }), { status: 500, headers: H });
  }
}
