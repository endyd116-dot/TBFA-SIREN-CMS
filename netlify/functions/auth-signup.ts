/**
 * POST /api/auth/signup
 * 회원가입 — 이메일 중복 확인 → 비밀번호 해싱 → DB 저장 → JWT 발급 → 쿠키 설정
 */
import { eq } from "drizzle-orm";
import { db, members } from "../../db";
import { hashPassword, signUserToken, buildCookie } from "../../lib/auth";
import { signupSchema, safeValidate } from "../../lib/validation";
import {
  ok, created, badRequest, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 입력 파싱 + 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v = safeValidate(signupSchema, body);
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

    const [newMember] = await db
      .insert(members)
      .values({
        email,
        passwordHash,
        name,
        phone,
        type: memberType,
        status,
        agreeEmail: true,
        agreeSms: true,
      })
      .returning({
        id: members.id,
        email: members.email,
        name: members.name,
        type: members.type,
        status: members.status,
      });

    /* 5. JWT 발급 + 쿠키 설정 */
    const token = signUserToken({
      uid: newMember.id,
      email: newMember.email,
      type: newMember.type,
      name: newMember.name,
    });
    const cookie = buildCookie("siren_token", token);

    /* 6. 감사 로그 */
    await logUserAction(req, newMember.id, newMember.name, "signup_success", {
      detail: { type: memberType, status },
    });

    /* 7. 응답 (status별 메시지) */
    const message =
      status === "pending"
        ? "가입 신청이 접수되었습니다. 관리자 승인 후 이용 가능합니다."
        : "회원가입이 완료되었습니다. 환영합니다 :)";

    const res = created(
      {
        user: {
          id: newMember.id,
          email: newMember.email,
          name: newMember.name,
          type: newMember.type,
          status: newMember.status,
        },
        token,
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