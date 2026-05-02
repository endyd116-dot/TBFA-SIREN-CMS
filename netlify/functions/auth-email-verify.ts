/**
 * POST /api/auth/email-verify
 * Body: { token }
 *
 * 이메일 인증 토큰 검증 → emailVerified=true 처리
 *
 * 보안 흐름:
 * 1. 토큰 입력 검증
 * 2. 토큰 해시 → DB 조회
 * 3. 사용 여부 확인 (1회용)
 * 4. 만료 확인 (24시간)
 * 5. 회원 조회 (정지/탈퇴 차단)
 * 6. 토큰의 email과 회원의 현재 email 일치 확인 (이메일 변경 방어)
 * 7. emailVerified=true 업데이트
 * 8. 같은 회원의 활성 토큰 모두 무효화
 * 9. 감사 로그 + 성공 응답
 */
import { eq, and, isNull } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";
import { db, members, emailVerificationTokens } from "../../db";
import { safeValidate } from "../../lib/validation";
import {
  ok, badRequest, unauthorized, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

/* ───────── 검증 스키마 ───────── */
const verifySchema = z.object({
  token: z.string().trim().min(20, "유효하지 않은 토큰"),
});

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 입력 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v: any = safeValidate(verifySchema, body);
    if (!v.ok) {
      return badRequest("입력값을 확인해 주세요", v.errors);
    }
    const token: string = v.data.token;

    /* 2. 토큰 해시 → 조회 */
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const now = new Date();

    const [tokenRow] = await db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.tokenHash, tokenHash))
      .limit(1);

    if (!tokenRow) {
      await logUserAction(req, null, null, "email_verify_failed", {
        detail: { reason: "token_not_found" },
        success: false,
      });
      return unauthorized("유효하지 않은 인증 링크입니다. 다시 요청해 주세요.");
    }

    /* 3. 사용 여부 확인 (1회용) */
    if (tokenRow.usedAt) {
      await logUserAction(req, tokenRow.memberId, null, "email_verify_failed", {
        detail: {
          reason: "token_already_used",
          usedAt: tokenRow.usedAt instanceof Date
            ? tokenRow.usedAt.toISOString()
            : String(tokenRow.usedAt),
        },
        success: false,
      });
      return unauthorized("이미 사용된 인증 링크입니다.");
    }

    /* 4. 만료 확인 (24시간) */
    const expiresAtDate = new Date(tokenRow.expiresAt as any);
    if (expiresAtDate.getTime() < now.getTime()) {
      await logUserAction(req, tokenRow.memberId, null, "email_verify_failed", {
        detail: {
          reason: "token_expired",
          expiresAt: expiresAtDate.toISOString(),
        },
        success: false,
      });
      return unauthorized("인증 링크가 만료되었습니다. 다시 요청해 주세요.");
    }

    /* 5. 회원 조회 */
    const [user] = await db
      .select({
        id: members.id,
        email: members.email,
        name: members.name,
        status: members.status,
        emailVerified: members.emailVerified,
      })
      .from(members)
      .where(eq(members.id, tokenRow.memberId))
      .limit(1);

    if (!user) {
      await logUserAction(req, tokenRow.memberId, null, "email_verify_failed", {
        detail: { reason: "user_not_found" },
        success: false,
      });
      return unauthorized("회원 정보를 찾을 수 없습니다");
    }

    /* 6. 정지/탈퇴 회원 차단 */
    if (user.status === "withdrawn" || user.status === "suspended") {
      await logUserAction(req, user.id, user.name, "email_verify_failed", {
        detail: { reason: "account_inactive", status: user.status },
        success: false,
      });
      return unauthorized("이용할 수 없는 계정입니다");
    }

    /* 7. 이미 인증된 회원이면 안내 (오류는 아님) */
    if (user.emailVerified) {
      /* 그래도 토큰은 무효화 */
      const tokenUpdatePayload: any = { usedAt: new Date() };
      await db
        .update(emailVerificationTokens)
        .set(tokenUpdatePayload)
        .where(eq(emailVerificationTokens.id, tokenRow.id));

      await logUserAction(req, user.id, user.name, "email_verify_already_done", {
        detail: { email: user.email },
      });
      return ok(
        { alreadyVerified: true, email: user.email },
        "이미 인증이 완료된 계정입니다. 정상적으로 이용 가능합니다.",
      );
    }

    /* 8. 토큰의 email과 회원의 현재 email 일치 확인 (이메일 변경 방어) */
    if (tokenRow.email !== user.email) {
      await logUserAction(req, user.id, user.name, "email_verify_failed", {
        detail: {
          reason: "email_mismatch",
          tokenEmail: tokenRow.email,
          currentEmail: user.email,
        },
        success: false,
      });
      return unauthorized(
        "이메일 주소가 변경되어 인증 링크가 유효하지 않습니다. 다시 요청해 주세요.",
      );
    }

    /* 9. emailVerified=true 업데이트 */
    const memberUpdatePayload: any = {
      emailVerified: true,
      updatedAt: new Date(),
    };
    await db
      .update(members)
      .set(memberUpdatePayload)
      .where(eq(members.id, user.id));

    /* 10. 같은 회원의 활성 토큰 모두 무효화 (방금 사용한 토큰 포함) */
    const tokenUpdatePayload: any = { usedAt: new Date() };
    await db
      .update(emailVerificationTokens)
      .set(tokenUpdatePayload)
      .where(
        and(
          eq(emailVerificationTokens.memberId, user.id),
          isNull(emailVerificationTokens.usedAt),
        ),
      );

    /* 11. 감사 로그 */
    await logUserAction(req, user.id, user.name, "email_verify_success", {
      detail: { email: user.email },
    });

    return ok(
      { alreadyVerified: false, email: user.email },
      "이메일 인증이 완료되었습니다. 모든 서비스를 이용하실 수 있습니다.",
    );
  } catch (err) {
    console.error("[auth-email-verify]", err);
    return serverError("이메일 인증 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/auth/email-verify" };