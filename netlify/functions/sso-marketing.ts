/**
 * sso-marketing — 허브(SIREN/tbfa-mis) SSO IdP 진입 → 함께워크 마케팅(SP, withwork.tbfa.co.kr)
 *
 * sso-on.ts / sso-si.ts와 동일 패턴. 마케팅 전용 시크릿·aud·대상으로 분리(한쪽 유출이 다른 SP에 안 번지게).
 *  - 허브 = IdP(발급), 함께워크 마케팅 = SP(검증)
 *  - 60초 단명 토큰(HS256, MARKETING_SSO_SECRET) 발급 → SP의 /api/sso/enter?t= 로 302
 *  - 계약: payload {sub,name,email,role, iss:"siren-hub", aud:"hamkkework-marketing"}, exp 60s
 *    sub = SIREN 관리자 uid → 마케팅 관리자 ssoUserId 매핑.
 *  - 미인증 시 허브(/admin-hub.html)로 되돌림.
 */
import jwt from "jsonwebtoken";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/sso-marketing" };

const SSO_SECRET = process.env.MARKETING_SSO_SECRET || "";
const TARGET = (process.env.HAMKKE_MARKETING_URL || "https://withwork.tbfa.co.kr").replace(/\/+$/, "");

export default async (req: Request) => {
  const g = await requireAdmin(req);
  if (guardFailed(g)) {
    // 미인증 → 허브로 되돌림(로그인 후 재시도)
    return new Response(null, { status: 302, headers: { Location: "/admin-hub.html" } });
  }

  // 보안: 시크릿 미설정 시 토큰 발급 거부 (약한 기본키 서명 방지 — fail-closed)
  if (!SSO_SECRET) {
    return new Response("SSO 미구성: MARKETING_SSO_SECRET 환경변수 필요", { status: 500 });
  }

  const a = g.ctx.admin; // AdminPayload { uid, email, role, name }
  const token = (jwt.sign as any)(
    {
      sub: String(a.uid),
      name: a.name,
      email: a.email,
      role: a.role,
      iss: "siren-hub",
      aud: "hamkkework-marketing",
    },
    SSO_SECRET,
    { expiresIn: "60s" },
  );

  return new Response(null, {
    status: 302,
    headers: { Location: `${TARGET}/api/sso/enter?t=${encodeURIComponent(token)}` },
  });
};
