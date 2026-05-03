/**
 * POST /api/admin/password
 * Body: { currentPassword, newPassword }
 *
 * 관리자 본인의 비밀번호 변경 (현재 비번 재인증 필수)
 *
 * 보안 흐름:
 * 1. 관리자 인증 (siren_admin_token)
 * 2. 입력 검증
 * 3. 회원 조회 (type=admin 또는 role=super_admin/operator 만 허용)
 * 4. 잠금 상태 확인
 * 5. 현재 비밀번호 검증 (틀리면 실패카운트 +1, 5회 시 잠금)
 * 6. 새 비번 강도 검증 (영문+숫자 8자 이상)
 * 7. 새 비번 ≠ 현재 비번 검증 (재사용 방지)
 * 8. 비밀번호 해싱 + 업데이트 + 잠금 카운트 초기화
 * 9. 활성 비밀번호 재설정 토큰 모두 무효화
 * 10. 감사 로그
 *
 * 주의:
 * - 이 함수는 admin 쿠키(siren_admin_token)만 받음
 * - 일반 사용자 비번 변경은 /api/auth/password 사용
 */
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, members, passwordResetTokens } from "../../db";
import {
  authenticateAdmin,
  verifyPassword,
  hashPassword,
  checkPasswordStrength,
} from "../../lib/auth";
import { safeValidate } from "../../lib/validation";
import {
  ok, badRequest, unauthorized, forbidden, tooManyRequests, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

const MAX_FAIL = Number(process.env.LOGIN_MAX_FAIL || 5);
const LOCK_MIN = Number(process.env.LOGIN_LOCK_MINUTES || 30);

/* ───────── 검증 스키마 ───────── */
const adminPasswordChangeSchema = z.object({
  currentPassword: z.string().min(1, "현재 비밀번호를 입력해 주세요"),
  newPassword: z.string().min(8, "새 비밀번호는 8자 이상").max(100, "새 비밀번호는 100자 이하"),
});

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 관리자 토큰 검증 */
    const auth = authenticateAdmin(req);
    if (!auth) return unauthorized("관리자 인증이 필요합니다");

    /* 2. 입력 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v: any = safeValidate(adminPasswordChangeSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);

    const currentPassword: string = v.data.currentPassword;
    const newPassword: string = v.data.newPassword;

    /* 3. 회원 조회 */
    const [user] = await db
      .select()
      .from(members)
      .where(eq(members.id, auth.uid))
      .limit(1);

    if (!user) return unauthorized("관리자 정보를 찾을 수 없습니다");

    /* ★ 관리자 권한 재확인 (토큰만으로는 불충분 — 권한 강등 시 즉시 차단) */
    const isAdmin =
      user.type === "admin" ||
      user.role === "super_admin" ||
      (user.role === "operator" && user.operatorActive !== false);

    if (!isAdmin) {
      return forbidden("관리자 권한이 없습니다");
    }

    if (user.status !== "active") {
      return forbidden("이용할 수 없는 계정입니다");
    }

    /* 4. 잠금 상태 확인 */
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const remainMin = Math.ceil(
        (new Date(user.lockedUntil).getTime() - Date.now()) / 60000
      );
      return tooManyRequests(
        `계정이 잠겨 있습니다. ${remainMin}분 후 다시 시도해 주세요.`
      );
    }

    /* 5. 현재 비밀번호 검증 */
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      const newFailCount = (user.loginFailCount ?? 0) + 1;
      const failPayload: any = { loginFailCount: newFailCount };

      if (newFailCount >= MAX_FAIL) {
        failPayload.lockedUntil = new Date(Date.now() + LOCK_MIN * 60 * 1000);
        failPayload.loginFailCount = 0;
      }
      await db.update(members).set(failPayload).where(eq(members.id, user.id));

      await logAdminAction(req, auth.uid, auth.name, "admin_password_change_failed", {
        detail: { reason: "wrong_current_password", failCount: newFailCount },
        success: false,
      });

      if (newFailCount >= MAX_FAIL) {
        return tooManyRequests(
          `비밀번호 ${MAX_FAIL}회 실패. ${LOCK_MIN}분간 잠금됩니다.`,
        );
      }
      return unauthorized(
        `현재 비밀번호가 일치하지 않습니다 (${newFailCount}/${MAX_FAIL})`,
      );
    }

    /* 6. 새 비밀번호 강도 검증 */
    const strength: any = checkPasswordStrength(newPassword);
    if (!strength.ok) {
      return badRequest(strength.reason || "새 비밀번호가 약합니다");
    }

    /* 7. 새 비번 ≠ 현재 비번 확인 */
    if (currentPassword === newPassword) {
      return badRequest("새 비밀번호는 현재 비밀번호와 달라야 합니다");
    }

    /* ★ K-9 보안: 기본 비번 'admin1234' 재사용 차단 */
    if (newPassword === "admin1234" || newPassword.toLowerCase() === "admin1234") {
      return badRequest(
        "기본 비밀번호는 사용할 수 없습니다. 다른 비밀번호를 입력해 주세요.",
      );
    }

    /* 8. 새 비번 해싱 + 업데이트 */
    const newHash = await hashPassword(newPassword);
    const memberUpdatePayload: any = {
      passwordHash: newHash,
      loginFailCount: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    };
    await db
      .update(members)
      .set(memberUpdatePayload)
      .where(eq(members.id, user.id));

    /* 9. 활성 비밀번호 재설정 토큰 모두 무효화 (보안) */
    const tokenInvalidatePayload: any = { usedAt: new Date() };
    await db
      .update(passwordResetTokens)
      .set(tokenInvalidatePayload)
      .where(
        and(
          eq(passwordResetTokens.memberId, user.id),
          isNull(passwordResetTokens.usedAt),
        ),
      );

    /* 10. 감사 로그 */
    await logAdminAction(req, auth.uid, auth.name, "admin_password_change_success", {
      detail: { email: user.email },
    });

    return ok(
      {},
      "관리자 비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용하세요.",
    );
  } catch (err) {
    console.error("[admin-password]", err);
    return serverError("비밀번호 변경 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/admin/password" };