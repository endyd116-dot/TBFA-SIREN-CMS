/**
 * 1회용 진단 — 현재 로그인 상태 + auth-me 응답이 어떻게 보이는지.
 * GET /api/_debug-me
 */
import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db, members } from "../../db";
import { authenticateUser } from "../../lib/auth";

export const config = { path: "/api/_debug-me" };

export default async (req: Request, _ctx: Context) => {
  const auth = authenticateUser(req);
  if (!auth) {
    return new Response(JSON.stringify({ ok: false, error: "비로그인", note: "siren_token 쿠키 없음" }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const [u] = await db.select({
    id: members.id, email: members.email, name: members.name,
    type: members.type, status: members.status,
    operatorActive: members.operatorActive,
  }).from(members).where(eq(members.id, auth.uid)).limit(1);

  const isAdmin    = u?.type === "admin";
  const isOperator = (u as any)?.operatorActive === true;

  return new Response(JSON.stringify({
    ok: true,
    tokenPayload: auth,
    dbUser: u,
    computed: {
      isAdmin, isOperator,
      canAdminMode: isAdmin || isOperator,
    },
    note: "위 canAdminMode가 true면 관리자 모드 버튼이 표시되어야 함",
  }, null, 2), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
};
