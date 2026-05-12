/**
 * POST /api/auth/logout
 * 로그아웃 — 쿠키 삭제 + 감사 로그 기록
 */
import { authenticateUser, clearCookie } from "../../lib/auth";
import {
  ok, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  /* 현재 로그인 사용자 (감사 로그용 — 없어도 무시) */
  const user = authenticateUser(req);

  if (user) {
    await logUserAction(req, user.uid, user.name, "logout", {
      detail: { type: user.type },
    });
  }

  /* 쿠키 삭제 응답 — 일반 토큰 + admin 토큰 둘 다
   * (admin/operator 통합 로그인 시 두 쿠키 발급되었을 수 있음) */
  const res = ok(null, "로그아웃되었습니다");
  res.headers.append("Set-Cookie", clearCookie("siren_token"));
  res.headers.append("Set-Cookie", clearCookie("siren_admin_token"));
  return res;
};

export const config = { path: "/api/auth/logout" };