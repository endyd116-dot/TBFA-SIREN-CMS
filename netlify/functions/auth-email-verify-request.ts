/**
 * POST /api/auth/email-verify-request
 *
 * 이메일 인증 메일 발송 (재발송 포함)
 *
 * 호출 시나리오:
 * 1. 회원가입 직후 자동 호출 (auth-signup.ts에서 직접 호출)
 * 2. 사용자가 마이페이지에서 "인증 메일 재발송" 버튼 클릭
 *
 * 보안 흐름:
 * 1. 로그인 검증 (재발송은 본인만 가능)
 * 2. 이미 인증된 회원이면 차단
 * 3. Rate Limit (1시간에 5회까지)
 * 4. 토큰 생성 (32바이트 raw → SHA-256 해시 저장)
 * 5. 메일 발송
 * 6. 성공 응답
 */
import { eq, and, gt } from "drizzle-orm";
import crypto from "crypto";
import { db, members, emailVerificationTokens } from "../../db";
import { authenticateUser } from "../../lib/auth";
import { sendEmail, tplEmailVerify } from "../../lib/email";
import {
  ok, badRequest, unauthorized, serverError,
  corsPreflight, methodNotAllowed,
  getClientIp, getUserAgent,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

/* ───────── 상수 ───────── */
const TOKEN_BYTES = 32;            // 64자 hex = 256bit 엔트로피
const TOKEN_TTL_HOURS = 24;        // 24시간 유효
const RATE_LIMIT_PER_HOUR = 5;     // 회원당 1시간에 5회까지

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 로그인 검증 */
    const auth = authenticateUser(req);
    if (!auth) {
      return unauthorized("로그인이 필요합니다");
    }

    /* 2. 회원 정보 조회 */
    const [user] = await db
      .select({
        id: members.id,
        email: members.email,
        name: members.name,
        status: members.status,
        emailVerified: members.emailVerified,
      })
      .from(members)
      .where(eq(members.id, auth.uid))
      .limit(1);

    if (!user) {
      return unauthorized("회원 정보를 찾을 수 없습니다");
    }

    /* 3. 회원 상태 확인 */
    if (user.status === "withdrawn" || user.status === "suspended") {
      return unauthorized("이용할 수 없는 계정입니다");
    }

    /* 4. 이미 인증된 회원이면 차단 */
    if (user.emailVerified) {
      return badRequest("이미 이메일 인증이 완료된 계정입니다");
    }

    /* 5. Rate Limit 체크 (회원당 1시간 내 5회까지) */
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentTokens = await db
      .select({ id: emailVerificationTokens.id })
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.memberId, user.id),
          gt(emailVerificationTokens.createdAt, oneHourAgo),
        ),
      );

    if (recentTokens.length >= RATE_LIMIT_PER_HOUR) {
      await logUserAction(req, user.id, user.name, "email_verify_request", {
        detail: { reason: "rate_limited", count: recentTokens.length },
        success: false,
      });
      return badRequest(
        `잠시 후 다시 시도해 주세요. 1시간에 최대 ${RATE_LIMIT_PER_HOUR}회까지 요청 가능합니다.`,
      );
    }

    /* 6. 토큰 생성 — raw는 메일에만, DB에는 SHA-256 해시 저장 */
    const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

    const insertPayload: any = {
      memberId: user.id,
      tokenHash,
      email: user.email,
      expiresAt,
      ipAddress: (getClientIp(req) || "").slice(0, 45),
      userAgent: (getUserAgent(req) || "").slice(0, 500),
    };
    await db.insert(emailVerificationTokens).values(insertPayload);

    /* 7. 메일 발송 */
    const tpl = tplEmailVerify({
      userName: user.name,
      rawToken,
      ttlHours: TOKEN_TTL_HOURS,
    });

    const mailResult = await sendEmail({
      to: user.email,
      subject: tpl.subject,
      html: tpl.html,
    });

    /* 8. 감사 로그 */
    await logUserAction(req, user.id, user.name, "email_verify_request", {
      detail: {
        email: user.email,
        emailSent: mailResult.ok,
        expiresAt: expiresAt.toISOString(),
        recentCount: recentTokens.length + 1,
      },
      success: mailResult.ok,
      error: mailResult.ok ? undefined : "메일 발송 실패",
    });

    /* 9. 응답 — 메일 발송 실패 시 사용자에게 알림 */
    if (!mailResult.ok) {
      return serverError("메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    }

    return ok(
      { email: user.email },
      `${user.email}로 인증 메일을 발송했습니다. 메일함을 확인해 주세요.`,
    );
  } catch (err) {
    console.error("[auth-email-verify-request]", err);
    return serverError("요청 처리 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/auth/email-verify-request" };