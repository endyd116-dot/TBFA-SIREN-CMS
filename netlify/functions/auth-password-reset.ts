/**
 * POST /api/auth/password-reset
 * Body: { token, password }
 *
 * 비밀번호 재설정 — 토큰 검증 후 실제 비밀번호 변경
 */
import { eq, and, isNull } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";
import { db, members, passwordResetTokens } from "../../db";
import { hashPassword, checkPasswordStrength } from "../../lib/auth";
import { safeValidate } from "../../lib/validation";
import {
  ok, badRequest, unauthorized, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

/* ───────── 검증 스키마 ───────── */
const resetSchema = z.object({
  token: z.string().trim().min(20, "유효하지 않은 토큰"),
  password: z.string().min(8, "비밀번호는 8자 이상").max(100, "비밀번호는 100자 이하"),
});

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 입력 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v: any = safeValidate(resetSchema, body);
    if (!v.ok) {
      return badRequest("입력값을 확인해 주세요", v.errors);
    }
    const data = v.data;
    const token: string = data.token;
    const password: string = data.password;

    /* 2. 비밀번호 강도 검증 */
    const strength: any = checkPasswordStrength(password);
    if (!strength.ok) {
      return badRequest(strength.reason || "비밀번호가 약합니다");
    }

    /* 3. 토큰 해시 → 조회 */
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const now = new Date();

    const [tokenRow] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .limit(1);

    if (!tokenRow) {
      await logUserAction(req, null, null, "password_reset_failed", {
        detail: { reason: "token_not_found" },
        success: false,
      });
      return unauthorized("유효하지 않은 링크입니다. 다시 요청해 주세요.");
    }

    /* 4. 사용 여부 확인 (1회용) */
    if (tokenRow.usedAt) {
      await logUserAction(req, tokenRow.memberId, null, "password_reset_failed", {
        detail: {
          reason: "token_already_used",
          usedAt: tokenRow.usedAt instanceof Date
            ? tokenRow.usedAt.toISOString()
            : String(tokenRow.usedAt),
        },
        success: false,
      });
      return unauthorized("이미 사용된 링크입니다. 다시 요청해 주세요.");
    }

    /* 5. 만료 확인 */
    const expiresAtDate = new Date(tokenRow.expiresAt as any);
    if (expiresAtDate.getTime() < now.getTime()) {
      await logUserAction(req, tokenRow.memberId, null, "password_reset_failed", {
        detail: {
          reason: "token_expired",
          expiresAt: expiresAtDate.toISOString(),
        },
        success: false,
      });
      return unauthorized("링크가 만료되었습니다. 다시 요청해 주세요.");
    }

    /* 6. 회원 조회 */
    const [user] = await db
      .select({
        id: members.id,
        email: members.email,
        name: members.name,
        status: members.status,
      })
      .from(members)
      .where(eq(members.id, tokenRow.memberId))
      .limit(1);

    if (!user) {
      await logUserAction(req, tokenRow.memberId, null, "password_reset_failed", {
        detail: { reason: "user_not_found" },
        success: false,
      });
      return unauthorized("회원 정보를 찾을 수 없습니다");
    }

    /* 7. 정지/탈퇴 회원 차단 */
    if (user.status === "withdrawn" || user.status === "suspended") {
      await logUserAction(req, user.id, user.name, "password_reset_failed", {
        detail: { reason: "account_inactive", status: user.status },
        success: false,
      });
      return unauthorized("이용할 수 없는 계정입니다");
    }

    /* 8. 비밀번호 업데이트 + 잠금/실패카운트 초기화 */
    const newHash: string = await hashPassword(password);
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

    /* 9. 같은 회원의 활성 토큰 모두 무효화 (방금 사용한 토큰 포함) */
    const tokenUpdatePayload: any = { usedAt: new Date() };
    await db
      .update(passwordResetTokens)
      .set(tokenUpdatePayload)
      .where(
        and(
          eq(passwordResetTokens.memberId, user.id),
          isNull(passwordResetTokens.usedAt),
        ),
      );

    /* 10. 감사 로그 */
    await logUserAction(req, user.id, user.name, "password_reset_success", {
      detail: { email: user.email },
    });

    return ok(
      {},
      "비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.",
    );
  } catch (err) {
    console.error("[auth-password-reset]", err);
    return serverError("비밀번호 변경 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/auth/password-reset" };