/**
 * sso-marketing — 허브(SIREN/tbfa-mis) SSO IdP 진입 → 함께워크 마케팅(SP, withwork.tbfa.co.kr)
 *
 * sso-on.ts / sso-si.ts와 동일 패턴. 마케팅 전용 시크릿·aud·대상으로 분리(한쪽 유출이 다른 SP에 안 번지게).
 *  - 허브 = IdP(발급), 함께워크 마케팅 = SP(검증)
 *  - 60초 단명 토큰(HS256, MARKETING_SSO_SECRET) 발급 → SP의 /api/sso/enter?t= 로 302
 *  - 계약: payload {sub,name,email,role,phone?, iss:"siren-hub", aud:"hamkkework-marketing"}, exp 60s
 *    sub = SIREN 관리자 uid → 마케팅 관리자 ssoUserId 매핑.
 *  - phone(2026-07-14 보강): 마케팅 쪽 알림(카카오·문자) 수신용. members.phone 원문 그대로 실어 보내고
 *    정규화는 받는 쪽 담당. 연락처가 비었거나 조회가 실패하면 claim을 아예 빼고 발급한다
 *    (선택 필드 — 없으면 종전 동작. 연락처 하나 때문에 관리자 진입이 막히면 안 됨).
 *  - 미인증 시 허브(/admin-hub.html)로 되돌림.
 */
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { members } from "../../db/schema";

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

  const a = g.ctx.admin; // AdminPayload { uid, email, role, name } — 연락처는 없어서 별도 조회

  let phone = "";
  try {
    const [row] = await db
      .select({ phone: members.phone })
      .from(members)
      .where(eq(members.id, Number(a.uid)))
      .limit(1);
    phone = (row?.phone || "").trim();
  } catch (err) {
    console.warn("[sso-marketing] 연락처 조회 실패 — phone 없이 발급", err);
  }

  const token = (jwt.sign as any)(
    {
      sub: String(a.uid),
      name: a.name,
      email: a.email,
      role: a.role,
      ...(phone ? { phone } : {}),
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
