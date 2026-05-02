/**
 * POST /api/auth/signup
 * 회원가입 — 이메일 중복 확인 → 비밀번호 해싱 → DB 저장 → JWT 발급 → 쿠키 설정
 *
 * ★ 분리 대화 K-1+ 적용:
 * - A-2: 응답 본문에서 token 필드 제거 (인증은 httpOnly 쿠키로만)
 * - E:   가입 직후 세션 쿠키 + 1d JWT 발급
 *
 * ★ K-2 추가:
 * - 가입 직후 이메일 인증 메일 자동 발송 (실패해도 가입은 성공)
 */
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { db, members, emailVerificationTokens } from "../../db";
import { hashPassword, signUserToken, buildCookie } from "../../lib/auth";
import { signupSchema, safeValidate } from "../../lib/validation";
import { sendEmail, tplEmailVerify } from "../../lib/email";
import {
  ok, created, badRequest, serverError,
  parseJson, corsPreflight, methodNotAllowed,
  getClientIp, getUserAgent,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

/* ───────── 이메일 인증 토큰 상수 (K-2) ───────── */
const TOKEN_BYTES = 32;
const TOKEN_TTL_HOURS = 24;

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 입력 파싱 + 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v: any = safeValidate(signupSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해주세요", v.errors);

    const { email, password, name, phone, memberType } = v.data;

    /* 2. 이메일 중복 확인 */
    const existing = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.email, email))
      .limit(1);

    if (existing.length > 0) {
      await logUserAction(req, null, name, "signup_failed", {
        detail: { email, reason: "email_duplicate" },
        success: false,
        error: "이미 가입된 이메일",
      });
      return badRequest("이미 가입된 이메일입니다");
    }

    /* 3. 비밀번호 해싱 */
    const passwordHash = await hashPassword(password);

    /* 4. 회원 등록
       - 일반/봉사자: 즉시 active
       - 유가족: 증빙 검토 필요 → pending */
    const status = memberType === "family" ? "pending" : "active";

    const insertPayload: any = {
      email,
      passwordHash,
      name,
      phone,
      type: memberType,
      status,
      agreeEmail: true,
      agreeSms: true,
    };

    const [newMember] = await db
      .insert(members)
      .values(insertPayload)
      .returning({
        id: members.id,
        email: members.email,
        name: members.name,
        type: members.type,
        status: members.status,
      });

    /* 5. ★ K-2: 이메일 인증 메일 자동 발송 (실패해도 가입은 성공) */
    let emailSentResult = false;
    let emailErrorMsg: string | null = null;
    try {
      const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

      const tokenInsertPayload: any = {
        memberId: newMember.id,
        tokenHash,
        email: newMember.email,
        expiresAt,
        ipAddress: (getClientIp(req) || "").slice(0, 45),
        userAgent: (getUserAgent(req) || "").slice(0, 500),
      };
      await db.insert(emailVerificationTokens).values(tokenInsertPayload);

      const tpl = tplEmailVerify({
        userName: newMember.name,
        rawToken,
        ttlHours: TOKEN_TTL_HOURS,
      });

      const mailResult = await sendEmail({
        to: newMember.email,
        subject: tpl.subject,
        html: tpl.html,
      });
      emailSentResult = !!mailResult.ok;
      if (!mailResult.ok) emailErrorMsg = "메일 발송 실패";
    } catch (mailErr) {
      console.error("[auth-signup] 인증 메일 발송 예외:", mailErr);
      emailErrorMsg = "메일 발송 중 예외 발생";
    }

    /* 6. ★ 분리 대화 E: JWT 발급 + 세션 쿠키 (1일 만료) */
    const token = signUserToken(
      {
        uid: newMember.id,
        email: newMember.email,
        type: newMember.type,
        name: newMember.name,
      },
      "1d"
    );
    /* 가입 직후는 명시적 "remember me" 선택이 없으므로 세션 쿠키 (브라우저 종료 시 만료) */
    const cookie = buildCookie("siren_token", token, { maxAge: null });

    /* 7. 감사 로그 */
    await logUserAction(req, newMember.id, newMember.name, "signup_success", {
      detail: {
        type: memberType,
        status,
        verifyEmailSent: emailSentResult,
        verifyEmailError: emailErrorMsg,
      },
    });

    /* 8. 응답 (status별 메시지 + 인증 메일 안내) */
    let message: string;
    if (status === "pending") {
      message = "가입 신청이 접수되었습니다. 관리자 승인 후 이용 가능합니다.";
    } else if (emailSentResult) {
      message = "회원가입이 완료되었습니다. 인증 메일을 발송했으니 메일함을 확인해 주세요. 환영합니다 :)";
    } else {
      message = "회원가입이 완료되었습니다. 환영합니다 :) (인증 메일 발송에 실패했으니 마이페이지에서 재발송해 주세요)";
    }

    /* ★ 분리 대화 A-2: 응답 본문에서 token 필드 제거 (인증은 httpOnly 쿠키만) */
    const res = created(
      {
        user: {
          id: newMember.id,
          email: newMember.email,
          name: newMember.name,
          type: newMember.type,
          status: newMember.status,
        },
        emailVerifySent: emailSentResult,
      },
      message
    );
    res.headers.set("Set-Cookie", cookie);
    return res;
  } catch (err) {
    console.error("[auth-signup]", err);
    return serverError("회원가입 처리 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/auth/signup" };