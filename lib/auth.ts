/**
 * SIREN — 인증 유틸리티
 * - 비밀번호 해싱 (bcryptjs)
 * - JWT 발급 및 검증 (사용자 / 관리자 분리)
 * - 권한 검증 미들웨어
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

/* =========================================================
   환경변수
   ========================================================= */
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-please-change";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "dev-admin-secret-please-change";
const ADMIN_JWT_EXPIRES_IN = process.env.ADMIN_JWT_EXPIRES_IN || "2h";
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);

/* =========================================================
   비밀번호 해싱 / 검증
   ========================================================= */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/* =========================================================
   JWT 페이로드 타입
   ========================================================= */
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

/* =========================================================
   사용자 JWT 발급 / 검증
   ========================================================= */
export function signUserToken(payload: UserPayload): string {
  return jwt.sign(payload as object, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyUserToken(token: string): UserPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as UserPayload;
  } catch {
    return null;
  }
}

/* =========================================================
   관리자 JWT 발급 / 검증 (별도 시크릿)
   ========================================================= */
export function signAdminToken(payload: AdminPayload): string {
  return jwt.sign(payload as object, ADMIN_JWT_SECRET, { expiresIn: ADMIN_JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyAdminToken(token: string): AdminPayload | null {
  try {
    return jwt.verify(token, ADMIN_JWT_SECRET) as AdminPayload;
  } catch {
    return null;
  }
}

/* =========================================================
   요청에서 토큰 추출
   - Authorization: Bearer xxx
   - 또는 Cookie: siren_token=xxx
   ========================================================= */
export function extractToken(req: Request, cookieName = "siren_token"): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/* =========================================================
   요청 인증 (사용자)
   ========================================================= */
export function authenticateUser(req: Request): UserPayload | null {
  const token = extractToken(req, "siren_token");
  if (!token) return null;
  return verifyUserToken(token);
}

/* =========================================================
   요청 인증 (관리자)
   ========================================================= */
export function authenticateAdmin(req: Request): AdminPayload | null {
  const token = extractToken(req, "siren_admin_token");
  if (!token) return null;
  return verifyAdminToken(token);
}

/* =========================================================
   쿠키 헬퍼
   ========================================================= */
export function buildCookie(
  name: string,
  value: string,
  options: { maxAge?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string } = {}
): string {
  const {
    maxAge = 60 * 60 * 24 * 7, // 7일
    httpOnly = true,
    secure = process.env.NODE_ENV !== "development",
    sameSite = "Lax",
    path = "/",
  } = options;
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAge}`,
    `Path=${path}`,
    `SameSite=${sameSite}`,
  ];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(name: string, path = "/"): string {
  return `${name}=; Max-Age=0; Path=${path}; HttpOnly; SameSite=Lax`;
}

/* =========================================================
   비밀번호 강도 검증
   ========================================================= */
export function checkPasswordStrength(pw: string): { ok: boolean; reason?: string } {
  if (pw.length < 8) return { ok: false, reason: "8자 이상이어야 합니다" };
  if (!/[A-Za-z]/.test(pw)) return { ok: false, reason: "영문이 포함되어야 합니다" };
  if (!/\d/.test(pw)) return { ok: false, reason: "숫자가 포함되어야 합니다" };
  return { ok: true };
}

/* =========================================================
   안전한 비교 (타이밍 어택 방지)
   ========================================================= */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}