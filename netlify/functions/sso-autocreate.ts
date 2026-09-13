/**
 * sso-autocreate — 허브(SIREN/tbfa-mis) SSO IdP 진입 → AutoCreate(SP, autocreate-endyd.netlify.app)
 *
 * sso-marketing.ts 와 동일 패턴(2026-09-14 · AutoCreate Phase 0). 전용 시크릿·aud·대상으로 분리(한쪽 유출이 다른 SP에 안 번지게).
 *  - 허브 = IdP(발급), AutoCreate = SP(검증 · /api/sso/enter)
 *  - 60초 단명 토큰(HS256, AUTOCREATE_SSO_SECRET) 발급 → SP 의 /api/sso/enter?t= 로 302
 *  - 계약: payload {sub,name,email,role, iss:"siren-hub", aud:"autocreate"}, exp 60s
 *    role = super_admin|admin|operator (SP 는 상향만 자동 반영 · lib/sso-role.ts)
 *  - env: AUTOCREATE_SSO_SECRET(= AutoCreate 의 SSO_SHARED_SECRET) · AUTOCREATE_URL(기본 https://autocreate-endyd.netlify.app)
 *  - 미인증 시 허브(/admin-hub.html)로 되돌림. 시크릿 미설정 시 발급 거부(fail-closed).
 */
import jwt from "jsonwebtoken";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/sso-autocreate" };

const SSO_SECRET = process.env.AUTOCREATE_SSO_SECRET || "";
const TARGET = (process.env.AUTOCREATE_URL || "https://autocreate-endyd.netlify.app").replace(/\/+$/, "");

export default async (req: Request) => {
  const g = await requireAdmin(req);
  if (guardFailed(g)) {
    return new Response(null, { status: 302, headers: { Location: "/admin-hub.html" } });
  }
  if (!SSO_SECRET) {
    return new Response("SSO 미구성: AUTOCREATE_SSO_SECRET 환경변수 필요", { status: 500 });
  }
  const a = g.ctx.admin; // AdminPayload { uid, email, role, name }
  const token = (jwt.sign as any)(
    { sub: String(a.uid), name: a.name, email: a.email, role: a.role, iss: "siren-hub", aud: "autocreate" },
    SSO_SECRET,
    { expiresIn: "60s" },
  );
  return new Response(null, {
    status: 302,
    headers: { Location: `${TARGET}/api/sso/enter?t=${encodeURIComponent(token)}`, "Cache-Control": "no-store" },
  });
};
