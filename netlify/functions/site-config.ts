/**
 * /api/site-config — 클라이언트에 필요한 환경설정 노출
 *
 * R39 Stage 5: 카카오 지도 JS SDK 키 등 프론트가 필요한 환경값 전달.
 * 인증된 사용자만 허용 (KAKAO_JS_APP_KEY는 공개 키이지만 도메인 화이트리스트 적용 권장).
 *
 * 응답:
 *   { ok:true, data: { kakaoJsAppKey: string|null, kakaoJsAvailable: boolean } }
 */
import type { Context } from "@netlify/functions";
import { requireActiveUser } from "../../lib/auth";

export const config = { path: "/api/site-config" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "GET만 지원" }), {
      status: 405, headers: JSON_HEADER,
    });
  }

  const auth = await requireActiveUser(req);
  if (!auth.ok) return (auth as any).res;

  const kakaoJsAppKey = process.env.KAKAO_JS_APP_KEY || null;

  return new Response(JSON.stringify({
    ok: true,
    data: {
      kakaoJsAppKey,
      kakaoJsAvailable: Boolean(kakaoJsAppKey),
    },
  }), { status: 200, headers: JSON_HEADER });
}
