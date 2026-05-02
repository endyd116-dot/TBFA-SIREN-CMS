/**
 * POST /api/auth/withdraw
 * Body: { password, reason? }
 *
 * 회원 탈퇴 처리
 *
 * 보안 흐름:
 * 1. 로그인 검증 (본인만 가능)
 * 2. 비밀번호 재확인 (본인 인증)
 * 3. 관리자/운영자 탈퇴 차단 (안전장치)
 * 4. 이미 탈퇴된 계정 차단
 * 5. 회원 정보 익명화 (email/name/phone)
 * 6. status='withdrawn', withdrawnAt, withdrawnReason 기록
 * 7. 비밀번호 해시 무력화
 * 8. 활성 토큰 모두 무효화 (비번 재설정/이메일 인증)
 * 9. 채팅 블랙리스트 자동 해제
 * 10. 확인 메일 발송 (실패해도 탈퇴는 성공)
 * 11. 감사 로그 + 쿠키 삭제
 */
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db, members, chatBlacklist,
  passwordResetTokens, emailVerificationTokens,
} from "../../db";
import { authenticateUser, verifyPassword, clearCookie } from "../../lib/auth";
import { safeValidate } from "../../lib/validation";
import { sendEmail, tplWithdrawConfirm } from "../../lib/email";
import {
  ok, badRequest, unauthorized, forbidden, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

/* ───────── 검증 스키마 ───────── */
const withdrawSchema = z.object({
  password: z.string().min(1, "비밀번호를 입력해 주세요"),
  reason: z.string().max(500, "탈퇴 사유는 500자 이하").optional(),
});

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 로그인 검증 */
    const auth = authenticateUser(req);
    if (!auth) return unauthorized("로그인이 필요합니다");

    /* 2. 입력 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v: any = safeValidate(withdrawSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);

    const password: string = v.data.password;
    const reason: string | undefined = v.data.reason;

    /* 3. 회원 조회 */
    const [user] = await db
      .select()
      .from(members)
      .where(eq(members.id, auth.uid))
      .limit(1);

    if (!user) return unauthorized("회원 정보를 찾을 수 없습니다");

    /* 4. 이미 탈퇴된 회원 차단 */
    if (user.status === "withdrawn") {
      return badRequest("이미 탈퇴 처리된 계정입니다");
    }

    /* 5. 관리자/운영자 탈퇴 차단 (안전장치) */
    if (
      user.type === "admin" ||
      user.role === "super_admin" ||
      user.role === "operator"
    ) {
      await logUserAction(req, user.id, user.name, "withdraw_blocked", {
        detail: {
          reason: "admin_or_operator_account",
          type: user.type,
          role: user.role,
        },
        success: false,
      });
      return forbidden(
        "관리자/운영자 계정은 탈퇴할 수 없습니다. 슈퍼 관리자에게 강등을 요청해 주세요."
      );
    }

    /* 6. 비밀번호 재확인 (본인 인증) */
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      await logUserAction(req, user.id, user.name, "withdraw_failed", {
        detail: { reason: "wrong_password" },
        success: false,
      });
      return unauthorized("비밀번호가 일치하지 않습니다");
    }

    /* 7. 메일 발송용 정보 백업 (익명화 전) */
    const originalEmail = user.email;
    const originalName = user.name;
    const withdrawnAt = new Date();

    /* 8. 회원 정보 익명화 + status=withdrawn
       - email: 고유 충돌 방지를 위해 ID + 타임스탬프 사용
       - name: "탈퇴한 회원"으로 통일
       - phone: null로 삭제
       - passwordHash: 무력화 (다시 로그인 불가)
    */
    const anonymousEmail = `withdrawn-${user.id}-${Date.now()}@deleted.local`;
    const memberUpdatePayload: any = {
      email: anonymousEmail,
      name: "탈퇴한 회원",
      phone: null,
      status: "withdrawn",
      withdrawnAt,
      withdrawnReason: reason || null,
      passwordHash: "WITHDRAWN_NO_LOGIN",
      loginFailCount: 0,
      lockedUntil: null,
      // 알림 수신 모두 해제
      agreeEmail: false,
      agreeSms: false,
      agreeMail: false,
      updatedAt: new Date(),
    };
    await db
      .update(members)
      .set(memberUpdatePayload)
      .where(eq(members.id, user.id));

    /* 9. 활성 토큰 모두 무효화 */
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

    await db
      .update(emailVerificationTokens)
      .set(tokenInvalidatePayload)
      .where(
        and(
          eq(emailVerificationTokens.memberId, user.id),
          isNull(emailVerificationTokens.usedAt),
        ),
      );

    /* 10. 채팅 블랙리스트 자동 해제 (탈퇴자는 더 이상 로그인 불가) */
    const blacklistUpdatePayload: any = {
      isActive: false,
      unblockedAt: new Date(),
      unblockedBy: user.id,
    };
    await db
      .update(chatBlacklist)
      .set(blacklistUpdatePayload)
      .where(
        and(
          eq(chatBlacklist.memberId, user.id),
          eq(chatBlacklist.isActive, true),
        ),
      );

    /* 11. 확인 메일 발송 (실패해도 탈퇴는 성공) */
    let emailSent = false;
    try {
      const tpl = tplWithdrawConfirm({
        userName: originalName,
        email: originalEmail,
        withdrawnAt,
      });
      const mailResult = await sendEmail({
        to: originalEmail,
        subject: tpl.subject,
        html: tpl.html,
      });
      emailSent = !!mailResult.ok;
    } catch (mailErr) {
      console.error("[auth-withdraw] 확인 메일 발송 실패:", mailErr);
    }

    /* 12. 감사 로그 */
    await logUserAction(req, user.id, originalName, "withdraw_success", {
      detail: {
        originalEmail,
        anonymousEmail,
        reasonProvided: !!reason,
        emailSent,
      },
    });

    /* 13. 응답 + 쿠키 삭제 */
    const res = ok(
      {},
      "회원 탈퇴가 완료되었습니다. 그동안 함께해 주셔서 감사합니다.",
    );
    res.headers.set("Set-Cookie", clearCookie("siren_token"));
    return res;
  } catch (err) {
    console.error("[auth-withdraw]", err);
    return serverError("회원 탈퇴 처리 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/auth/withdraw" };