/**
 * 전화번호 SMS 인증 헬퍼 — 효성 후원자 사이트 가입 흐름 A안
 *
 * 흐름:
 *   1) phone-verify-send: 코드 생성 → SMS → INSERT phone_verifications
 *   2) phone-verify-check: 코드 검증 → verified=true + verifyToken 발급 + matched_member_id
 *   3) signup: verifyToken으로 phone_verifications 조회 → matched_member 있으면 UPDATE / 없으면 INSERT
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { aligoSend } from "./aligo-client";
import { randomBytes } from "crypto";

/** 전화번호 정규화: 대시·공백 제거 → 순숫자. aligo-client의 내부 동일 헬퍼와 일치. */
export function normalizePhone(raw: string): string {
  return String(raw || "").replace(/[^0-9]/g, "");
}

/* 정책 */
export const CODE_EXPIRES_MS = 3 * 60 * 1000;        // 3분 (솔라피 즉시 발송 — 짧은 유효시간으로 복귀)
export const TOKEN_EXPIRES_MS = 10 * 60 * 1000;      // 10분 (인증 후 가입 완료 제한시간)
export const MAX_ATTEMPTS = 5;                        // 코드 입력 시도 횟수
export const RATE_LIMIT_SHORT = 1;                   // 단기(3분) 발송 가능 횟수 — 코드 만료 후 재발송 허용
export const RATE_LIMIT_1HOUR = 5;                   // 1시간
export const RATE_LIMIT_1DAY = 10;                   // 1일

/** 6자리 코드 생성 (앞자리 0 포함) */
export function generateVerifyCode(): string {
  const n = Math.floor(Math.random() * 1_000_000);
  return String(n).padStart(6, "0");
}

/** UUID 형식 토큰 (64자 hex) */
export function generateVerifyToken(): string {
  return randomBytes(32).toString("hex");
}

/** Aligo SMS로 인증 코드 발송.
 *  timeout=true는 프록시 응답 지연 — 발송이 진행 중일 수 있어 호출부에서 row 롤백 금지. */
export async function sendVerifyCodeSms(phone: string, code: string): Promise<{ ok: boolean; error?: string; timeout?: boolean }> {
  const message = `[교사유가족협의회] 인증번호 ${code} (3분 이내 입력해 주세요)`;
  try {
    const r = await aligoSend({ receiver: phone, msg: message });
    if (!r.ok) return { ok: false, error: r.error || `Aligo error code=${r.resultCode}`, timeout: r.timeout };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}

/** Rate limit 체크 — 같은 phone에서 최근 N분 동안 발송 횟수 */
export async function checkRateLimit(phone: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const r: any = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '3 minutes')::int  AS cshort,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour')::int     AS c1hour,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')::int      AS c1day
      FROM phone_verifications
      WHERE phone = ${phone}
    `);
    const row = (r?.rows ?? r ?? [])[0] || {};
    if (Number(row.cshort) >= RATE_LIMIT_SHORT) return { ok: false, message: "방금 인증번호를 발송했습니다. 인증번호는 3분간 유효하며, 만료 후 재발송할 수 있습니다." };
    if (Number(row.c1hour) >= RATE_LIMIT_1HOUR) return { ok: false, message: "1시간 이내 발송 횟수를 초과했습니다." };
    if (Number(row.c1day) >= RATE_LIMIT_1DAY)  return { ok: false, message: "오늘 발송 횟수를 초과했습니다." };
    return { ok: true };
  } catch {
    return { ok: true };  /* 조회 실패 시 차단 안 함 */
  }
}

/** phone 기반 기존 회원 매칭 — 효성·기업은행 등 외부 연동 후원자 식별 */
export interface MatchedMember {
  id: number;
  name: string;
  isHyosung: boolean;          /* hyosung_member_no NOT NULL */
  hasEmail: boolean;           /* 실제 이메일 등록 여부 (auto placeholder 제외) */
  donationCount: number;       /* 후원 횟수 */
}

export async function findMatchedMemberByPhone(phone: string): Promise<MatchedMember | null> {
  try {
    const r: any = await db.execute(sql`
      SELECT m.id, m.name, m.email, m.hyosung_member_no,
             COALESCE((SELECT COUNT(*)::int FROM donations d WHERE d.member_id = m.id AND d.status = 'completed'), 0) AS donation_count
        FROM members m
       WHERE m.phone = ${phone}
         AND m.withdrawn_at IS NULL
       ORDER BY m.id ASC
       LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) return null;
    const isPlaceholderEmail = !row.email || String(row.email).includes("@auto.") || String(row.email).endsWith(".auto.local");
    return {
      id: Number(row.id),
      name: String(row.name || ""),
      isHyosung: row.hyosung_member_no != null,
      hasEmail: !isPlaceholderEmail,
      donationCount: Number(row.donation_count) || 0,
    };
  } catch {
    return null;
  }
}

/** 인증 코드 INSERT */
export async function insertVerification(opts: { phone: string; code: string; ip: string | null }): Promise<number | null> {
  try {
    const expiresAt = new Date(Date.now() + CODE_EXPIRES_MS);
    const r: any = await db.execute(sql`
      INSERT INTO phone_verifications (phone, code, expires_at, ip, created_at)
      VALUES (${opts.phone}, ${opts.code}, ${expiresAt.toISOString()}::timestamp, ${opts.ip}, NOW())
      RETURNING id
    `);
    return Number((r?.rows ?? r ?? [])[0]?.id) || null;
  } catch {
    return null;
  }
}

/** 인증 row 삭제 (SMS 발송 실패 시 롤백용 — rate limit 부정 누적 방지) */
export async function deleteVerification(id: number): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM phone_verifications WHERE id = ${id}`);
  } catch {}
}

/** 코드 검증 — 가장 최근의 미사용 row 조회 → code 일치 시 verified=true + token 발급 */
export interface VerifyResult {
  ok: boolean;
  reason?: "no_pending" | "expired" | "attempts_exceeded" | "mismatch";
  verifyToken?: string;
  tokenExpiresAt?: string;
  matchedMemberId?: number | null;
}

export async function verifyCode(phone: string, code: string): Promise<VerifyResult> {
  /* 가장 최근 row 1개 */
  let row: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, code, expires_at, attempts, verified
        FROM phone_verifications
       WHERE phone = ${phone}
       ORDER BY created_at DESC
       LIMIT 1
    `);
    row = (r?.rows ?? r ?? [])[0];
  } catch {}
  if (!row) return { ok: false, reason: "no_pending" };
  if (row.verified) return { ok: false, reason: "no_pending" };   /* 이미 사용된 row */

  const expiresAt = new Date(row.expires_at);
  if (expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  const attempts = Number(row.attempts || 0);
  if (attempts >= MAX_ATTEMPTS) return { ok: false, reason: "attempts_exceeded" };

  /* 코드 비교 */
  if (String(row.code) !== String(code)) {
    /* attempts++ */
    try {
      await db.execute(sql`UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = ${Number(row.id)}`);
    } catch {}
    return { ok: false, reason: "mismatch" };
  }

  /* 통과 — verified=true + token 발급 + matched_member_id 결정 */
  const verifyToken = generateVerifyToken();
  const tokenExpiresAt = new Date(Date.now() + TOKEN_EXPIRES_MS);
  const matched = await findMatchedMemberByPhone(phone);

  try {
    await db.execute(sql`
      UPDATE phone_verifications
         SET verified = TRUE,
             verify_token = ${verifyToken},
             token_expires_at = ${tokenExpiresAt.toISOString()}::timestamp,
             matched_member_id = ${matched?.id ?? null}
       WHERE id = ${Number(row.id)}
    `);
  } catch (e: any) {
    return { ok: false, reason: "no_pending" };
  }

  return {
    ok: true,
    verifyToken,
    tokenExpiresAt: tokenExpiresAt.toISOString(),
    matchedMemberId: matched?.id ?? null,
  };
}

/** verifyToken으로 인증 row 조회 (signup 단계에서 사용) */
export async function consumeVerifyToken(verifyToken: string): Promise<{
  phone: string; matchedMemberId: number | null;
} | null> {
  try {
    const r: any = await db.execute(sql`
      SELECT phone, matched_member_id, token_expires_at
        FROM phone_verifications
       WHERE verify_token = ${verifyToken}
         AND verified = TRUE
       ORDER BY created_at DESC
       LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) return null;
    if (new Date(row.token_expires_at).getTime() < Date.now()) return null;
    return {
      phone: String(row.phone),
      matchedMemberId: row.matched_member_id ? Number(row.matched_member_id) : null,
    };
  } catch {
    return null;
  }
}

