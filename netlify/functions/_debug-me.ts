import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db, members } from "../../db";
import { authenticateUser } from "../../lib/auth";

export const config = { path: "/api/_debug-me" };

export default async (req: Request, _ctx: Context) => {
  const auth = authenticateUser(req);
  if (!auth) {
    /* 토큰 디코딩까지 시도 */
    const cookieHdr = req.headers.get("cookie") || "";
    return new Response(JSON.stringify({
      ok: false, step: "no_token",
      cookieHeaderRaw: cookieHdr.slice(0, 500),
      hasUserToken: cookieHdr.includes("siren_token="),
      hasAdminToken: cookieHdr.includes("siren_admin_token="),
    }, null, 2), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
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
    computed: { isAdmin, isOperator, canAdminMode: isAdmin || isOperator },
  }, null, 2), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
};
