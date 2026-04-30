/**
 * POST /api/auth/login
 * 로그인 — 이메일 조회 → 비밀번호 검증 → 잠금 처리 → JWT 발급 → 쿠키 설정
 */
import { eq } from "drizzle-orm";
import { db, members } from "../../db";
import { verifyPassword, signUserToken, buildCookie } from "../../lib/auth";
import { loginSchema, safeValidate } from "../../lib/validation";
import {
  ok, badRequest, unauthorized, forbidden, tooManyRequests,
  serverError, parseJson, corsPreflight, methodNotAllowed,
  getClientIp,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

const MAX_FAIL = Number(process.env.LOGIN_MAX_FAIL || 5);
const LOCK_MIN = Number(process.env.LOGIN_LOCK_MINUTES || 30);

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 입력 파싱 + 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v = safeValidate(loginSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해주세요", v.errors);

    const { email, password } = v.data;

    /* 2. 이메일로 회원 조회 */
    const [user] = await db
      .select()
      .from(members)
      .where(eq(members.email, email))
      .limit(1);

    if (!user) {
      // 보안상 "이메일 없음" 과 "비밀번호 틀림" 메시지를 통일
      await logUserAction(req, null, email, "login_failed", {
        detail: { reason: "user_not_found" },
        success: false,
      });
      return unauthorized("이메일 또는 비밀번호가 일치하지 않습니다");
    }

    /* 3. 잠금 상태 확인 */
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

    /* 4. 회원 상태 확인 */
    if (user.status === "suspended") {
      return forbidden("정지된 계정입니다. 관리자에게 문의해 주세요.");
    }
    if (user.status === "withdrawn") {
      return forbidden("탈퇴한 계정입니다.");
    }

    /* 5. 비밀번호 검증 */
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

    /* 6. 승인 대기 상태 안내 */
    if (user.status === "pending") {
      return forbidden("관리자 승인 대기 중입니다. 승인 후 이용 가능합니다.");
    }

    /* 7. 로그인 성공 — 잠금/실패카운트 초기화, 마지막 로그인 갱신 */
    await db
      .update(members)
      .set({
        loginFailCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: getClientIp(req).slice(0, 45),
      })
      .where(eq(members.id, user.id));

    /* 8. JWT 발급 + 쿠키 설정 */
    const token = signUserToken({
      uid: user.id,
      email: user.email,
      type: user.type,
      name: user.name,
    });
    const cookie = buildCookie("siren_token", token);

    /* 9. 감사 로그 */
    await logUserAction(req, user.id, user.name, "login_success", {
      detail: { type: user.type },
    });

    /* 10. 응답 */
    const res = ok(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          type: user.type,
          status: user.status,
        },
        token,
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