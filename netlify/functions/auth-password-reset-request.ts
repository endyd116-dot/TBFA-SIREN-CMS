/**
 * POST /api/auth/password-reset-request
 * Body: { email }
 *
 * 비밀번호 재설정 링크 발송 요청
 *
 * 보안 흐름:
 * 1. 이메일 형식 검증
 * 2. 회원 조회 (없거나 탈퇴면 동일 응답 — enumeration 방지)
 * 3. Rate Limit (1시간에 3회까지)
 * 4. 토큰 생성 (32바이트 raw → SHA-256 해시 저장)
 * 5. 메일 발송
 * 6. 항상 동일한 성공 메시지 응답 (정보 노출 X)
 */
import { eq, and, gt } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";
import { db, members, passwordResetTokens } from "../../db";
import { sendEmail, tplPasswordReset } from "../../lib/email";
import {
  ok, badRequest, serverError,
  parseJson, corsPreflight, methodNotAllowed,
  getClientIp, getUserAgent,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

/* ───────── 검증 스키마 ───────── */
const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email("올바른 이메일을 입력하세요"),
});

/* ───────── 상수 ───────── */
const TOKEN_BYTES = 32;            // 64자 hex = 256bit 엔트로피
const TOKEN_TTL_MIN = 30;          // 30분 유효
const RATE_LIMIT_PER_HOUR = 3;     // 회원당 1시간에 3회까지

/* ───────── 보안: 항상 같은 성공 메시지 (enumeration 방지) ───────── */
const SUCCESS_MESSAGE =
  "입력하신 이메일이 등록되어 있다면 비밀번호 재설정 링크를 발송했습니다. 메일함을 확인해 주세요.";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 입력 파싱 + 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("올바른 이메일을 입력하세요");
    }
    const { email } = parsed.data;

    /* 2. 회원 조회 — 없으면 가짜 성공 응답 (enumeration 방지) */
    const [user] = await db
      .select({
        id: members.id,
        email: members.email,
        name: members.name,
        status: members.status,
      })
      .from(members)
      .where(eq(members.email, email))
      .limit(1);

    if (!user) {
      await logUserAction(req, null, email, "password_reset_request", {
        detail: { reason: "user_not_found", email },
        success: false,
      });
      return ok({}, SUCCESS_MESSAGE);
    }

    /* 3. 탈퇴 회원 차단 — 동일 가짜 응답 */
    if (user.status === "withdrawn") {
      await logUserAction(req, user.id, user.name, "password_reset_request", {
        detail: { reason: "withdrawn" },
        success: false,
      });
      return ok({}, SUCCESS_MESSAGE);
    }

    /* 4. 정지 회원도 동일 가짜 응답 (관리자 문의 안내는 별도 채널로) */
    if (user.status === "suspended") {
      await logUserAction(req, user.id, user.name, "password_reset_request", {
        detail: { reason: "suspended" },
        success: false,
      });
      return ok({}, SUCCESS_MESSAGE);
    }

    /* 5. Rate Limit 체크 (회원당 1시간 내 3회까지) */
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentTokens = await db
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.memberId, user.id),
          gt(passwordResetTokens.createdAt, oneHourAgo),
        ),
      );

    if (recentTokens.length >= RATE_LIMIT_PER_HOUR) {
      await logUserAction(req, user.id, user.name, "password_reset_request", {
        detail: { reason: "rate_limited", count: recentTokens.length },
        success: false,
      });
      // 보안상 동일 메시지 반환 (공격자에게 정보 X)
      return ok({}, SUCCESS_MESSAGE);
    }

    /* 6. 토큰 생성 — raw는 메일에만, DB에는 SHA-256 해시 저장 */
    const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 60 * 1000);

    await db.insert(passwordResetTokens).values({
      memberId: user.id,
      tokenHash,
      expiresAt,
      ipAddress: (getClientIp(req) || "").slice(0, 45),
      userAgent: (getUserAgent(req) || "").slice(0, 500),
    });

    /* 7. 메일 발송 */
    const tpl = tplPasswordReset({
      userName: user.name,
      rawToken,
      ttlMinutes: TOKEN_TTL_MIN,
    });

    const mailResult = await sendEmail({
      to: user.email,
      subject: tpl.subject,
      html: tpl.html,
    });

    /* 8. 감사 로그 */
    await logUserAction(req, user.id, user.name, "password_reset_request", {
      detail: {
        emailSent: mailResult.ok,
        expiresAt: expiresAt.toISOString(),
        recentCount: recentTokens.length + 1,
      },
      success: mailResult.ok,
      error: mailResult.ok ? undefined : "메일 발송 실패",
    });

    /* 9. 메일 발송 실패해도 동일 메시지 (사용자에게 정보 노출 X) */
    return ok({}, SUCCESS_MESSAGE);
  } catch (err) {
    console.error("[auth-password-reset-request]", err);
    return serverError("요청 처리 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/auth/password-reset-request" };