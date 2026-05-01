/**
 * POST /api/admin/login
 * 관리자 로그인 — 별도 시크릿/쿠키 사용 (siren_admin_token)
 */
import { eq } from "drizzle-orm";
import { db, members } from "../../db";
import { verifyPassword, signAdminToken, buildCookie } from "../../lib/auth";
import { adminLoginSchema, safeValidate } from "../../lib/validation";
import {
  ok, badRequest, unauthorized, forbidden, tooManyRequests,
  serverError, parseJson, corsPreflight, methodNotAllowed,
  getClientIp,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

const ADMIN_DEFAULT_ID = process.env.ADMIN_DEFAULT_ID || "admin";
const MAX_FAIL = Number(process.env.LOGIN_MAX_FAIL || 5);
const LOCK_MIN = Number(process.env.LOGIN_LOCK_MINUTES || 30);

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v = safeValidate(adminLoginSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해주세요", v.errors);

    const { id, password } = v.data;

    /* 'admin' ID는 admin@siren-org.kr 로 매핑 */
    const email = id === ADMIN_DEFAULT_ID
      ? "admin@siren-org.kr"
      : id.includes("@") ? id.toLowerCase() : `${id}@siren-org.kr`;

    /* 회원 조회 (관리자 타입만) */
    const [user] = await db
      .select()
      .from(members)
      .where(eq(members.email, email))
      .limit(1);

    if (!user || user.type !== "admin") {
      await logAudit({
        req, userId: null, userType: "admin", userName: id,
        action: "admin_login_failed",
        detail: { reason: "not_admin_or_not_found", id },
        success: false,
      });
      return unauthorized("ID 또는 비밀번호가 일치하지 않습니다");
    }

    /* 잠금 확인 */
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const remain = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000);
      return tooManyRequests(`계정이 잠겨 있습니다. ${remain}분 후 다시 시도해 주세요.`);
    }

    if (user.status !== "active") {
      return forbidden("이용할 수 없는 계정입니다");
    }

    /* 비밀번호 검증 */
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      const newCount = (user.loginFailCount ?? 0) + 1;
      const updateData: any = { loginFailCount: newCount };
      if (newCount >= MAX_FAIL) {
        updateData.lockedUntil = new Date(Date.now() + LOCK_MIN * 60 * 1000);
        updateData.loginFailCount = 0;
      }
      await db.update(members).set(updateData).where(eq(members.id, user.id));

      await logAudit({
        req, userId: user.id, userType: "admin", userName: user.name,
        action: "admin_login_failed",
        detail: { failCount: newCount, locked: newCount >= MAX_FAIL },
        success: false,
      });

      if (newCount >= MAX_FAIL) {
        return tooManyRequests(`로그인 ${MAX_FAIL}회 실패. ${LOCK_MIN}분간 잠금됩니다.`);
      }
      return unauthorized(`ID 또는 비밀번호가 일치하지 않습니다 (${newCount}/${MAX_FAIL})`);
    }

    /* 로그인 성공 */
    await db.update(members).set({
      loginFailCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: getClientIp(req).slice(0, 45),
    }).where(eq(members.id, user.id));

    /* 관리자 전용 토큰 + 쿠키 (2시간) */
    const token = signAdminToken({
      uid: user.id,
      email: user.email,
      role: "super_admin",
      name: user.name,
    });
    const cookie = buildCookie("siren_admin_token", token, { maxAge: 60 * 60 * 2 });

    await logAudit({
      req, userId: user.id, userType: "admin", userName: user.name,
      action: "admin_login_success",
    });

    const res = ok({
      admin: { id: user.id, email: user.email, name: user.name, role: "super_admin" },
      token,
    }, "관리자 인증 완료. 환영합니다.");
    res.headers.set("Set-Cookie", cookie);
    return res;
  } catch (err) {
    console.error("[admin-login]", err);
    return serverError("로그인 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin/login" };