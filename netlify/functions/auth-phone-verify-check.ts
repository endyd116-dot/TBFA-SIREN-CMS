/**
 * POST /api/auth/phone-verify-check
 *
 * 효성 후원자 사이트 가입 흐름 A안 — SMS 인증 코드 확인 + verifyToken 발급.
 *
 * 요청 body: { phone, code }
 *
 * 응답:
 *   { ok: true, verifyToken, expiresAt,
 *     matchedMember: { id, name, isHyosung, hasEmail, donationCount, mode } | null }
 *
 *   mode 값:
 *     - "existing_hyosung": 효성 후원자 매칭됨 (email 없음 → 가입 흐름 활성화 유도)
 *     - "existing_full":    이미 사이트 회원 (email 있음 → 로그인 또는 비번 재설정 안내)
 *     - "new":              매칭 없음 (신규 가입)
 */

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import {
  normalizePhone, verifyCode, findMatchedMemberByPhone,
} from "../../lib/phone-verify";

export const config = { path: "/api/auth/phone-verify-check" };

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
  const code = String(body?.code || "").trim();
  if (!phoneRaw || !code) {
    return new Response(jsonKST({ ok: false, error: "전화번호와 인증번호를 입력해 주세요" }),
      { status: 400, headers: JSON_HEADER });
  }

  const phone = normalizePhone(phoneRaw);
  const result = await verifyCode(phone, code);

  if (!result.ok) {
    const errorMap: Record<string, string> = {
      no_pending: "인증번호가 만료되었거나 발송 기록이 없습니다. 인증번호를 다시 받아주세요.",
      expired: "인증번호가 만료되었습니다 (5분). 다시 받아주세요.",
      attempts_exceeded: "인증번호 입력 횟수를 초과했습니다. 인증번호를 다시 받아주세요.",
      mismatch: "인증번호가 일치하지 않습니다.",
    };
    const errorMsg = errorMap[result.reason || ""] || "인증 실패";
    return new Response(jsonKST({
      ok: false, error: errorMsg, reason: result.reason,
    }), { status: 400, headers: JSON_HEADER });
  }

  /* 매칭된 회원 정보 + mode 결정 */
  let matchedMember: any = null;
  if (result.matchedMemberId) {
    const m = await findMatchedMemberByPhone(phone);
    if (m) {
      const mode = m.hasEmail
        ? "existing_full"            /* 이미 사이트 회원 — 로그인 안내 */
        : (m.isHyosung ? "existing_hyosung" : "existing_donor");  /* 효성·기타 외부 후원자 — 가입 흐름 */
      matchedMember = { ...m, mode };
    }
  }

  return new Response(jsonKST({
    ok: true,
    verifyToken: result.verifyToken,
    expiresAt: result.tokenExpiresAt,
    matchedMember,
    message: matchedMember
      ? (matchedMember.mode === "existing_full"
          ? "이미 가입하신 분이에요. 로그인하시거나 비밀번호를 재설정해 주세요."
          : `이미 ${matchedMember.isHyosung ? "효성으로" : ""} 후원해 주시는 ${matchedMember.name}님이군요! 이메일·비밀번호를 추가하시면 마이페이지에서 후원 관리하실 수 있습니다.`)
      : "인증 완료. 이어서 가입을 진행해 주세요.",
  }, null, 2), { status: 200, headers: JSON_HEADER });
};
