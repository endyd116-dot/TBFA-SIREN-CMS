/**
 * POST /api/auth/admin-elevate
 *
 * 통합 로그인된 사용자가 admin/operator라면 admin 토큰을 발급해
 * 관리자 모드(cms-tbfa.html, admin.html 등)로 진입할 수 있게 함.
 *
 * 로그인 시 자동 발급 대신 별도 분리 — 두 쿠키를 동시에 발급하면 일부 환경에서
 * 첫 번째 Set-Cookie가 누락되는 문제 회피.
 *
 * Response: { ok, redirect: "/cms-tbfa.html", admin: {id, role, name} }
 */

import { eq } from "drizzle-orm";
import { db, members } from "../../db";
import { authenticateUser, signAdminToken, buildCookie } from "../../lib/auth";
import {
  ok, unauthorized, forbidden, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    const auth = authenticateUser(req);
    if (!auth) return unauthorized("로그인이 필요합니다");

    const [user] = await db
      .select({
        id: members.id, email: members.email, name: members.name,
        type: members.type, status: members.status, role: members.role,
        operatorActive: members.operatorActive,
      })
      .from(members)
      .where(eq(members.id, auth.uid))
      .limit(1);

    if (!user) return unauthorized("회원 정보를 찾을 수 없습니다");
    if (user.status !== "active") return forbidden("이용할 수 없는 계정입니다");

    const isAdmin    = user.type === "admin";
    const isOperator = (user as any).operatorActive === true;
    if (!isAdmin && !isOperator) {
      return forbidden("관리자 권한이 없습니다");
    }

    /* 로그인 유지(remember) 선택 시 관리자 세션 1일(KST 기준 로그인 후 24시간).
       미선택 시 기존대로 2시간 JWT + 세션 쿠키(브라우저 종료 시 삭제). */
    const wantRemember = (auth as any).remember === true;
    const ADMIN_DAY_SEC = 60 * 60 * 24; // 24시간

    /* 유지 선택: 1일 / 미선택: 6시간(2026-07-09 Swain — 무활동 세션 2h→6h) */
    const adminToken = signAdminToken({
      uid:   user.id,
      email: user.email,
      role:  (user.role ?? "operator"),
      name:  user.name,
      remember: wantRemember,
    }, wantRemember ? "1d" : "6h");
    const cookie = buildCookie("siren_admin_token", adminToken, {
      /* 유지 선택: 24시간 영속 쿠키(PWA·브라우저 종료 후 재실행에도 유지)
         미선택: null → 세션 쿠키(브라우저 종료 시 삭제) */
      maxAge: wantRemember ? ADMIN_DAY_SEC : null,
    });

    const res = ok({
      admin: { id: user.id, email: user.email, name: user.name, role: (user.role ?? "operator") },
      redirect: "/cms-tbfa.html",
    }, "관리자 모드 진입");
    res.headers.set("Set-Cookie", cookie);
    return res;
  } catch (err) {
    console.error("[auth-admin-elevate]", err);
    return serverError("관리자 모드 진입 중 오류", err);
  }
};

export const config = { path: "/api/auth/admin-elevate" };
