/**
 * sso-on — 허브(SIREN/tbfa-mis) SSO IdP 진입
 *
 * 로그인된 허브 관리자를 "함께워크 ON"(SP)으로 단일 로그인 진입시킨다.
 *  - 허브 = IdP(발급), 함께워크 ON = SP(검증)
 *  - 60초 단명 토큰(HS256, SIREN_SSO_SECRET) 발급 → SP의 /api/sso/enter?t= 로 302
 *  - 계약: payload {sub,name,email,role, iss:"siren-hub", aud:"hamkkework-on"}, exp 60s
 *    sub = SIREN 관리자 식별자(uid) → 함께워크 operator.ssoUserId 로 매핑
 *
 * 미인증 시 허브(/admin-hub.html)로 되돌림.
 */
import jwt from "jsonwebtoken";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/sso-on" };

const SSO_SECRET = process.env.SIREN_SSO_SECRET || "";
// ★ 2026-05-28: 함께워크 ON 커스텀 도메인 withon.tbfa.co.kr 컷오버.
//   env(HAMKKE_ON_URL)가 우선이지만, 코드 default도 새 도메인으로 정합 → env 누락 시도 안전.
const TARGET = process.env.HAMKKE_ON_URL || "https://withon.tbfa.co.kr";

export default async (req: Request) => {
  const g = await requireAdmin(req);
  if (guardFailed(g)) {
    // 미인증 → 허브로 되돌림(로그인 후 재시도)
    return new Response(null, { status: 302, headers: { Location: "/admin-hub.html" } });
  }

  // 보안: 시크릿 미설정 시 토큰 발급 거부 (약한 기본키 서명 방지 — fail-closed)
  if (!SSO_SECRET) {
    return new Response("SSO 미구성: SIREN_SSO_SECRET 환경변수 필요", { status: 500 });
  }

  const a = g.ctx.admin; // AdminPayload { uid, email, role, name }
  const token = (jwt.sign as any)(
    {
      sub: String(a.uid),
      name: a.name,
      email: a.email,
      role: a.role,
      iss: "siren-hub",
      aud: "hamkkework-on",
    },
    SSO_SECRET,
    { expiresIn: "60s" },
  );

  return new Response(null, {
    status: 302,
    headers: { Location: `${TARGET}/api/sso/enter?t=${encodeURIComponent(token)}` },
  });
};
