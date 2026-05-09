/**lib/auth.ts
 * SIREN — 인증 유틸리티
 * ★ K-1+ E: buildCookie 세션 쿠키 지원
 * ★ K-1+ A-4: DUMMY_BCRYPT_HASH export (타이밍 공격 방어용)
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET: string = process.env.JWT_SECRET || "dev-secret-please-change";
const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || "7d";
const ADMIN_JWT_SECRET: string = process.env.ADMIN_JWT_SECRET || "dev-admin-secret-please-change";
const ADMIN_JWT_EXPIRES_IN: string = process.env.ADMIN_JWT_EXPIRES_IN || "2h";
const BCRYPT_ROUNDS: number = Number(process.env.BCRYPT_ROUNDS || 10);

/* ★ A-4: 타이밍 공격 방어용 더미 해시
   - 실제 비밀번호 아님 (어떤 평문과도 매칭되지 않음)
   - 이메일 미존재 시 이 해시로 verifyPassword 호출하여 응답 시간 균일화 */
export const DUMMY_BCRYPT_HASH =
  "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/* 비밀번호 해싱 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/* JWT 페이로드 타입 */
export interface UserPayload {
  uid: number;
  email: string;
  type: "regular" | "family" | "volunteer" | "admin";
  name: string;
}

export interface AdminPayload {
  uid: number;
  email: string;
  role: string;
  name: string;
}

/* JWT 발급/검증 — expiresIn을 매 호출마다 다르게 줄 수 있도록 인자 추가 */
export function signUserToken(payload: UserPayload, expiresIn?: string): string {
  return (jwt.sign as any)(payload, JWT_SECRET, {
    expiresIn: expiresIn || JWT_EXPIRES_IN,
  });
}

export function verifyUserToken(token: string): UserPayload | null {
  try {
    return (jwt.verify as any)(token, JWT_SECRET) as UserPayload;
  } catch {
    return null;
  }
}

export function signAdminToken(payload: AdminPayload, expiresIn?: string): string {
  return (jwt.sign as any)(payload, ADMIN_JWT_SECRET, {
    expiresIn: expiresIn || ADMIN_JWT_EXPIRES_IN,
  });
}

export function verifyAdminToken(token: string): AdminPayload | null {
  try {
    return (jwt.verify as any)(token, ADMIN_JWT_SECRET) as AdminPayload;
  } catch {
    return null;
  }
}

/* 토큰 추출 */
export function extractToken(req: Request, cookieName: string = "siren_token"): string | null {
  const auth = req.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(new RegExp("(?:^|;\\s*)" + cookieName + "=([^;]+)"));
  return match ? decodeURIComponent(match[1]) : null;
}

/* 인증 헬퍼 */
export function authenticateUser(req: Request): UserPayload | null {
  const token = extractToken(req, "siren_token");
  if (!token) return null;
  return verifyUserToken(token);
}

export function authenticateAdmin(req: Request): AdminPayload | null {
  const token = extractToken(req, "siren_admin_token");
  if (!token) return null;
  return verifyAdminToken(token);
}

/* ★ 5순위 #1: 블랙 통합 — DB status 체크 + 차단 응답
   사용처: SIREN 3개, 유족 지원, 채팅 등 차단 대상 API
   기존 authenticateUser 호출 부분을 이 함수로 교체하면 자동 차단 적용. */
export async function requireActiveUser(req: Request): Promise<
  | { ok: true; user: UserPayload }
  | { ok: false; res: Response }
> {
  const user = authenticateUser(req);
  if (!user) {
    return {
      ok: false,
      res: new Response(
        JSON.stringify({ ok: false, error: "로그인이 필요합니다" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  // DB 조회로 현재 상태 확인 (블랙·정지·탈퇴)
  try {
    const { db } = await import("../db");
    const { members } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const rows: any = await db
      .select({
        status: members.status,
        blacklistReason: members.blacklistReason,
        withdrawnAt: members.withdrawnAt,
      })
      .from(members)
      .where(eq(members.id, user.uid))
      .limit(1);
    const m = rows[0];
    if (!m) {
      return {
        ok: false,
        res: new Response(
          JSON.stringify({ ok: false, error: "회원 정보를 찾을 수 없습니다" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        ),
      };
    }
    if (m.withdrawnAt) {
      return {
        ok: false,
        res: new Response(
          JSON.stringify({ ok: false, error: "탈퇴한 계정입니다" }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        ),
      };
    }
    if (m.status === "suspended") {
      return {
        ok: false,
        res: new Response(
          JSON.stringify({
            ok: false,
            error: "귀하의 서비스가 차단되었습니다.",
            blacklisted: true,
            reason: m.blacklistReason || null,
          }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        ),
      };
    }
    if (m.status !== "active") {
      // pending 등 active가 아니면 차단
      return {
        ok: false,
        res: new Response(
          JSON.stringify({ ok: false, error: "계정 승인 대기 또는 비활성 상태입니다" }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        ),
      };
    }
  } catch (err: any) {
    console.error("[requireActiveUser] DB 조회 실패:", err?.message || err);
    // DB 일시 오류는 인증 실패로 처리 (안전 측)
    return {
      ok: false,
      res: new Response(
        JSON.stringify({ ok: false, error: "인증 검증 중 오류" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  return { ok: true, user };
}

/* ★ K-1+ E: 쿠키 옵션 — maxAge에 null 지정 시 세션 쿠키 발급 */
export interface CookieOptions {
  /**
   * 쿠키 생명주기 (초 단위)
   * - 숫자: Max-Age 설정 (영속 쿠키 — 브라우저 종료 후에도 유지)
   * - null: Max-Age 생략 → 세션 쿠키 (브라우저 종료 시 즉시 삭제)
   * - undefined: 기본값(7일) 사용
   */
  maxAge?: number | null;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  path?: string;
  domain?: string;
}

export function buildCookie(name: string, value: string, options: CookieOptions = {}): string {
  /* ★ 핵심: maxAge가 명시적으로 null이면 Max-Age 추가 안 함 → 세션 쿠키 */
  const useSession = options.maxAge === null;
  const maxAge = useSession ? null : (options.maxAge ?? 60 * 60 * 24 * 7);

  const httpOnly = options.httpOnly ?? true;
  const isProduction =
    process.env.NODE_ENV !== "development" && !process.env.NETLIFY_DEV;
  const secure = options.secure ?? isProduction;
  const sameSite = options.sameSite ?? "Lax";
  const path = options.path ?? "/";

  const parts: string[] = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    `SameSite=${sameSite}`,
  ];
  /* ★ maxAge가 null이면 Max-Age 라인 자체를 생략 → 세션 쿠키 */
  if (maxAge !== null) parts.push(`Max-Age=${maxAge}`);
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  if (options.domain) parts.push(`Domain=${options.domain}`);

  return parts.join("; ");
}

export function clearCookie(name: string, path: string = "/"): string {
  return `${name}=; Max-Age=0; Path=${path}; HttpOnly; SameSite=Lax`;
}

/* 비밀번호 강도 검증 */
export function checkPasswordStrength(pw: string): { ok: boolean; reason?: string } {
  if (pw.length < 8) return { ok: false, reason: "8자 이상이어야 합니다" };
  if (!/[A-Za-z]/.test(pw)) return { ok: false, reason: "영문이 포함되어야 합니다" };
  if (!/\d/.test(pw)) return { ok: false, reason: "숫자가 포함되어야 합니다" };
  return { ok: true };
}

/* 안전한 비교 (타이밍 어택 방지) */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}