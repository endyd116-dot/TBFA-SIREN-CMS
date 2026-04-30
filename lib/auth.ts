/**
 * SIREN — 인증 유틸리티
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

/* 환경변수 */
const JWT_SECRET: string = process.env.JWT_SECRET || "dev-secret-please-change";
const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || "7d";
const ADMIN_JWT_SECRET: string = process.env.ADMIN_JWT_SECRET || "dev-admin-secret-please-change";
const ADMIN_JWT_EXPIRES_IN: string = process.env.ADMIN_JWT_EXPIRES_IN || "2h";
const BCRYPT_ROUNDS: number = Number(process.env.BCRYPT_ROUNDS || 10);

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

/* JWT 발급/검증 — any 캐스팅으로 타입 충돌 회피 */
export function signUserToken(payload: UserPayload): string {
  return (jwt.sign as any)(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyUserToken(token: string): UserPayload | null {
  try {
    return (jwt.verify as any)(token, JWT_SECRET) as UserPayload;
  } catch {
    return null;
  }
}

export function signAdminToken(payload: AdminPayload): string {
  return (jwt.sign as any)(payload, ADMIN_JWT_SECRET, { expiresIn: ADMIN_JWT_EXPIRES_IN });
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

/* 쿠키 헬퍼 */
export interface CookieOptions {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  path?: string;
}

export function buildCookie(name: string, value: string, options: CookieOptions = {}): string {
  const maxAge = options.maxAge ?? 60 * 60 * 24 * 7;
  const httpOnly = options.httpOnly ?? true;
  const secure = options.secure ?? (process.env.NODE_ENV !== "development");
  const sameSite = options.sameSite ?? "Lax";
  const path = options.path ?? "/";

  const parts: string[] = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAge}`,
    `Path=${path}`,
    `SameSite=${sameSite}`,
  ];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
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