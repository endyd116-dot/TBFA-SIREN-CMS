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

  /* 쿠키 삭제 응답 */
  const res = ok(null, "로그아웃되었습니다");
  res.headers.set("Set-Cookie", clearCookie("siren_token"));
  return res;
};

export const config = { path: "/api/auth/logout" };