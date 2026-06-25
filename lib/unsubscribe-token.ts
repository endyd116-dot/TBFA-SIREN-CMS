// lib/unsubscribe-token.ts
// ★ 2026-06-26 수신거부 토큰 — 발송 본문의 수신거부 링크 식별자(서명·위조 불가).
//   토큰 = `${memberId}.${channel}.${sig}` (sig = HMAC-SHA256(memberId:channel, secret) base64url 24자)
//   로그인 없이 클릭만으로 동작하되, 서명으로 위조/타인 거부 차단.

import crypto from "crypto";

function secret(): string {
  return process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || "tbfa-unsub-fallback";
}

const VALID_CH = new Set(["email", "sms", "kakao"]);

export function makeUnsubToken(memberId: number, channel: string): string {
  const ch = VALID_CH.has(channel) ? channel : "email";
  const sig = crypto.createHmac("sha256", secret()).update(`${memberId}:${ch}`).digest("base64url").slice(0, 24);
  return `${memberId}.${ch}.${sig}`;
}

export function verifyUnsubToken(token: string): { memberId: number; channel: string } | null {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [mid, ch, sig] = parts;
  if (!VALID_CH.has(ch)) return null;
  const expected = crypto.createHmac("sha256", secret()).update(`${mid}:${ch}`).digest("base64url").slice(0, 24);
  // timing-safe 비교
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  const memberId = Number(mid);
  if (!Number.isInteger(memberId) || memberId <= 0) return null;
  return { memberId, channel: ch };
}

/** 발송 본문에 붙일 수신거부 링크 URL */
export function unsubUrl(baseUrl: string, memberId: number, channel: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/unsubscribe.html?t=${encodeURIComponent(makeUnsubToken(memberId, channel))}`;
}
