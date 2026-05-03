/**
 * POST /api/auth/password
 * Body: { currentPassword, newPassword }
 *
 * 로그인 사용자의 비밀번호 변경 (현재 비번 재인증 필수)
 */
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, members, passwordResetTokens } from "../../db";
import {
  authenticateUser,
  verifyPassword,
  hashPassword,
  checkPasswordStrength,
} from "../../lib/auth";
import { safeValidate } from "../../lib/validation";
import {
  ok, badRequest, unauthorized, tooManyRequests, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

const MAX_FAIL = Number(process.env.LOGIN_MAX_FAIL || 5);
const LOCK_MIN = Number(process.env.LOGIN_LOCK_MINUTES || 30);

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "현재 비밀번호를 입력해 주세요"),
  newPassword: z.string().min(8, "새 비밀번호는 8자 이상").max(100, "새 비밀번호는 100자 이하"),
});

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    const auth = authenticateUser(req);
    if (!auth) return unauthorized("로그인이 필요합니다");

    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v: any = safeValidate(passwordChangeSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);

    const currentPassword: string = v.data.currentPassword;
    const newPassword: string = v.data.newPassword;

    const [user] = await db
      .select()
      .from(members)
      .where(eq(members.id, auth.uid))
      .limit(1);

    if (!user) return unauthorized("회원 정보를 찾을 수 없습니다");

    if (user.status === "withdrawn" || user.status === "suspended") {
      return unauthorized("이용할 수 없는 계정입니다");
    }

    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const remainMin = Math.ceil(
        (new Date(user.lockedUntil).getTime() - Date.now()) / 60000
      );
      return tooManyRequests(
        `계정이 잠겨 있습니다. ${remainMin}분 후 다시 시도해 주세요.`
      );
    }

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      const newFailCount = (user.loginFailCount ?? 0) + 1;
      const failPayload: any = { loginFailCount: newFailCount };

      if (newFailCount >= MAX_FAIL) {
        failPayload.lockedUntil = new Date(Date.now() + LOCK_MIN * 60 * 1000);
        failPayload.loginFailCount = 0;
      }
      await db.update(members).set(failPayload).where(eq(members.id, user.id));

      await logUserAction(req, user.id, user.name, "password_change_failed", {
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

    const strength: any = checkPasswordStrength(newPassword);
    if (!strength.ok) {
      return badRequest(strength.reason || "새 비밀번호가 약합니다");
    }

    if (currentPassword === newPassword) {
      return badRequest("새 비밀번호는 현재 비밀번호와 달라야 합니다");
    }

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

    await logUserAction(req, user.id, user.name, "password_change_success", {
      detail: { email: user.email },
    });

    return ok(
      {},
      "비밀번호가 변경되었습니다.",
    );
  } catch (err) {
    console.error("[auth-password]", err);
    return serverError("비밀번호 변경 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/auth/password" };