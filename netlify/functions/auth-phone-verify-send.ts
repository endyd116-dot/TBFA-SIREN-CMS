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

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import {
  normalizePhone, checkRateLimit, generateVerifyCode,
  sendVerifyCodeSms, insertVerification, deleteVerification, CODE_EXPIRES_MS,
} from "../../lib/phone-verify";

export const config = { path: "/api/auth/phone-verify-send" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST만 허용" }),
      { status: 405, headers: JSON_HEADER });
  }

  let body: any = {};
  try { body = await req.json(); } catch {
    return new Response(jsonKST({ ok: false, error: "JSON 파싱 실패" }),
      { status: 400, headers: JSON_HEADER });
  }

  const phoneRaw = String(body?.phone || "").trim();
  if (!phoneRaw) {
    return new Response(jsonKST({ ok: false, error: "전화번호를 입력해 주세요" }),
      { status: 400, headers: JSON_HEADER });
  }

  const phone = normalizePhone(phoneRaw);
  if (!/^01[0-9]{8,9}$/.test(phone)) {
    return new Response(jsonKST({ ok: false, error: "올바른 휴대전화 번호가 아닙니다" }),
      { status: 400, headers: JSON_HEADER });
  }

  /* Rate limit */
  const rl = await checkRateLimit(phone);
  if (!rl.ok) {
    return new Response(jsonKST({ ok: false, error: rl.message, step: "rate_limit" }),
      { status: 429, headers: JSON_HEADER });
  }

  /* 코드 생성·INSERT·SMS 발송 */
  const code = generateVerifyCode();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const id = await insertVerification({ phone, code, ip });
  if (!id) {
    return new Response(jsonKST({ ok: false, error: "인증 코드 저장 실패", step: "insert" }),
      { status: 500, headers: JSON_HEADER });
  }

  const sms = await sendVerifyCodeSms(phone, code);
  if (!sms.ok) {
    /* timeout(프록시 응답 지연)은 발송이 백그라운드로 진행 중일 수 있음 →
       row를 지우지 않고 유지하고, 입력창을 띄우는 응답(ok:true, pending)을 보낸다.
       (롤백하면 늦게 도착한 문자의 코드가 "발송 기록 없음"으로 무효가 되는 결함 차단) */
    if (sms.timeout) {
      return new Response(jsonKST({
        ok: true,
        pending: true,
        sentAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + CODE_EXPIRES_MS).toISOString(),
        message: "인증번호를 발송 중입니다. 받으시면 입력해 주세요. (유효시간 3분)",
      }), { status: 200, headers: JSON_HEADER });
    }
    /* 명시적 발송 실패(번호 오류·알리고 거부 등)만 롤백 — rate limit 부정 누적 방지 */
    await deleteVerification(id);
    /* 안정화 2: 사용자에겐 친절한 안내, 기술 사유(sms.error)는 서버 로그·detail로만 */
    console.warn("[phone-verify-send] SMS 발송 실패:", sms.error);
    return new Response(jsonKST({
      ok: false,
      error: "인증번호 발송에 실패했습니다. 잠시 후 다시 시도해 주세요. 계속 안 되면 협회로 문의해 주세요.",
      step: "send",
      detail: (sms.error || "").slice(0, 200),
    }), { status: 500, headers: JSON_HEADER });
  }

  return new Response(jsonKST({
    ok: true,
    sentAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + CODE_EXPIRES_MS).toISOString(),
    message: "인증번호를 발송했습니다. 3분 이내에 입력해 주세요.",
  }), { status: 200, headers: JSON_HEADER });
};
