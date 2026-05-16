/**
 * POST /api/auth/phone-verify-send
 *
 * 효성 후원자 사이트 가입 흐름 A안 — 전화번호 SMS 인증 코드 발송.
 *
 * 요청 body: { phone: "01012345678" 또는 "010-1234-5678" }
 *
 * 응답:
 *   { ok: true, sentAt, expiresAt, message }
 *   { ok: false, error, retryAfter? }   (rate limit 시)
 */

import type { Context } from "@netlify/functions";
import {
  normalizePhone, checkRateLimit, generateVerifyCode,
  sendVerifyCodeSms, insertVerification, CODE_EXPIRES_MS,
} from "../../lib/phone-verify";

export const config = { path: "/api/auth/phone-verify-send" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }),
      { status: 405, headers: JSON_HEADER });
  }

  let body: any = {};
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "JSON 파싱 실패" }),
      { status: 400, headers: JSON_HEADER });
  }

  const phoneRaw = String(body?.phone || "").trim();
  if (!phoneRaw) {
    return new Response(JSON.stringify({ ok: false, error: "전화번호를 입력해 주세요" }),
      { status: 400, headers: JSON_HEADER });
  }

  const phone = normalizePhone(phoneRaw);
  if (!/^01[0-9]{8,9}$/.test(phone)) {
    return new Response(JSON.stringify({ ok: false, error: "올바른 휴대전화 번호가 아닙니다" }),
      { status: 400, headers: JSON_HEADER });
  }

  /* Rate limit */
  const rl = await checkRateLimit(phone);
  if (!rl.ok) {
    return new Response(JSON.stringify({ ok: false, error: rl.message, step: "rate_limit" }),
      { status: 429, headers: JSON_HEADER });
  }

  /* 코드 생성·INSERT·SMS 발송 */
  const code = generateVerifyCode();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const id = await insertVerification({ phone, code, ip });
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: "인증 코드 저장 실패", step: "insert" }),
      { status: 500, headers: JSON_HEADER });
  }

  const sms = await sendVerifyCodeSms(phone, code);
  if (!sms.ok) {
    return new Response(JSON.stringify({
      ok: false, error: "SMS 발송 실패", step: "send", detail: (sms.error || "").slice(0, 200),
    }), { status: 500, headers: JSON_HEADER });
  }

  return new Response(JSON.stringify({
    ok: true,
    sentAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + CODE_EXPIRES_MS).toISOString(),
    message: "인증번호를 발송했습니다. 5분 이내에 입력해 주세요.",
  }), { status: 200, headers: JSON_HEADER });
};
