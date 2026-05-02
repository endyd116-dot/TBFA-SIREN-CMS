/**
 * POST /api/auth/login
 * 로그인 — 이메일 조회 → 비밀번호 검증 → 잠금 처리 → JWT 발급 → 쿠키 설정
 *
 * ★ K-1+ A-1: 비밀번호 검증 후에 상태 체크 (정보 유출 방지)
 * ★ K-1+ A-2: 응답 본문에서 token 제거 (XSS 방어)
 * ★ K-1+ A-4: 타이밍 공격 방어 (이메일 미존재 시 더미 verify)
 * ★ K-1+ B-5: getClientIp null 가드
 * ★ K-1+ E:   remember 옵션 시 14일 영속 쿠키 / 미체크 시 세션 쿠키 (브라우저 종료 시 삭제)
 */
import { eq } from "drizzle-orm";
import { db, members } from "../../db";
import {
  verifyPassword, signUserToken, buildCookie, DUMMY_BCRYPT_HASH,
} from "../../lib/auth";
import { loginSchema, safeValidate } from "../../lib/validation";
import {
  ok, badRequest, unauthorized, forbidden, tooManyRequests,
  serverError, parseJson, corsPreflight, methodNotAllowed,
  getClientIp,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

const MAX_FAIL = Number(process.env.LOGIN_MAX_FAIL || 5);
const LOCK_MIN = Number(process.env.LOGIN_LOCK_MINUTES || 30);

/* ★ E: 쿠키 + JWT 만료 정책 */
const REMEMBER_MAX_AGE = 60 * 60 * 24 * 14; // 14일 (체크 시 영속)
const REMEMBER_JWT_EXPIRES = "14d";
const SHORT_JWT_EXPIRES = "1d"; // 미체크 시 1일 토큰 (세션 쿠키와 함께)

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 입력 파싱 + 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v = safeValidate(loginSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해주세요", v.errors);

    const { email, password, remember } = v.data;
    const wantRemember = remember === true;

    /* 2. 이메일로 회원 조회 */
    const [user] = await db
      .select()
      .from(members)
      .where(eq(members.email, email))
      .limit(1);

    /* ★ A-4: 이메일 미존재 시 더미 verify로 타이밍 공격 방어
       (실제 비밀번호와 절대 매칭되지 않는 해시이며, 단순히 시간 균일화 목적) */
    if (!user) {
      await verifyPassword(password, DUMMY_BCRYPT_HASH);
      await logUserAction(req, null, email, "login_failed", {
        detail: { reason: "user_not_found" },
        success: false,
      });
      return unauthorized("이메일 또는 비밀번호가 일치하지 않습니다");
    }

    /* 3. 잠금 상태 확인 (비밀번호 검증 전 — 본인이 트리거한 잠금이므로 노출 OK) */
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const remainMin = Math.ceil(
        (new Date(user.lockedUntil).getTime() - Date.now()) / 60000
      );
      await logUserAction(req, user.id, user.name, "login_locked", {
        detail: { remainMin },
        success: false,
      });
      return tooManyRequests(
        `계정이 잠겨 있습니다. ${remainMin}분 후 다시 시도해 주세요.`
      );
    }

    /* 4. ★ A-1: 비밀번호 검증을 상태 체크보다 먼저 수행 */
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      const newFailCount = (user.loginFailCount ?? 0) + 1;
      const updateData: any = { loginFailCount: newFailCount };

      if (newFailCount >= MAX_FAIL) {
        updateData.lockedUntil = new Date(Date.now() + LOCK_MIN * 60 * 1000);
        updateData.loginFailCount = 0;
      }
      await db.update(members).set(updateData).where(eq(members.id, user.id));

      await logUserAction(req, user.id, user.name, "login_failed", {
        detail: { failCount: newFailCount, locked: newFailCount >= MAX_FAIL },
        success: false,
      });

      if (newFailCount >= MAX_FAIL) {
        return tooManyRequests(
          `로그인 ${MAX_FAIL}회 실패. ${LOCK_MIN}분간 잠금됩니다.`
        );
      }
      return unauthorized(
        `이메일 또는 비밀번호가 일치하지 않습니다 (${newFailCount}/${MAX_FAIL})`
      );
    }

    /* 5. ★ A-1: 비밀번호 검증 통과 후에 계정 상태 확인 (이메일 enumeration 방지) */
    if (user.status === "suspended") {
      await logUserAction(req, user.id, user.name, "login_blocked", {
        detail: { reason: "suspended" }, success: false,
      });
      return forbidden("정지된 계정입니다. 관리자에게 문의해 주세요.");
    }
    if (user.status === "withdrawn") {
      await logUserAction(req, user.id, user.name, "login_blocked", {
        detail: { reason: "withdrawn" }, success: false,
      });
      return forbidden("탈퇴한 계정입니다.");
    }
    if (user.status === "pending") {
      return forbidden("관리자 승인 대기 중입니다. 승인 후 이용 가능합니다.");
    }

    /* 6. 로그인 성공 — 잠금/실패카운트 초기화, 마지막 로그인 갱신 */
    await db
      .update(members)
      .set({
        loginFailCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        /* ★ B-5: null 가드 */
        lastLoginIp: (getClientIp(req) || "").slice(0, 45),
      })
      .where(eq(members.id, user.id));

    /* 7. ★ E: JWT + 쿠키 발급 (remember 분기) */
    const token = signUserToken(
      {
        uid: user.id,
        email: user.email,
        type: user.type,
        name: user.name,
      },
      wantRemember ? REMEMBER_JWT_EXPIRES : SHORT_JWT_EXPIRES
    );
    const cookie = buildCookie("siren_token", token, {
      /* ★ 핵심:
         - 체크함:   Max-Age=14일 (영속 쿠키 → 브라우저 종료해도 14일 유지)
         - 미체크:   null (세션 쿠키 → 브라우저 종료 시 즉시 삭제) */
      maxAge: wantRemember ? REMEMBER_MAX_AGE : null,
    });

    /* 8. 감사 로그 */
    await logUserAction(req, user.id, user.name, "login_success", {
      detail: { type: user.type, remember: wantRemember },
    });

    /* 9. ★ A-2: 응답 본문에서 token 제거 (XSS로부터 보호) */
    const res = ok(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          type: user.type,
          status: user.status,
        },
        /* token 필드 제거 — 인증은 httpOnly 쿠키로만 */
      },
      "로그인되었습니다. 환영합니다 :)"
    );
    res.headers.set("Set-Cookie", cookie);
    return res;
  } catch (err) {
    console.error("[auth-login]", err);
    return serverError("로그인 처리 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/auth/login" };