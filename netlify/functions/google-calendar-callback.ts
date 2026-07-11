// netlify/functions/google-calendar-callback.ts
// GET /api/google-calendar-callback?code=XXX&state=YYY : OAuth 콜백 — 토큰 저장
// Q3-020: 브라우저 리다이렉트 대상이므로 JSON이 아니라 자동 닫기 HTML 반환(팝업 종료·부모창 통지).
// Q3-021: state nonce를 httpOnly 쿠키와 대조해 CSRF 방지.

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { googleCalendarTokens } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { methodNotAllowed } from "../../lib/response";

/** 팝업에서 부모창에 결과를 알리고 스스로 닫는 HTML 응답 (+ state 쿠키 제거). */
function htmlPage(message: string, opts?: { error?: boolean }): Response {
  const clearCookie = "gcal_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
  const redirect = "/workspace-calendar.html?gcal=" + (opts?.error ? "error" : "connected");
  const msgType = opts?.error ? "'gcal-error'" : "'gcal-connected'";
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,-apple-system,sans-serif;padding:48px 24px;text-align:center;color:#374151">
<p style="font-size:15px;line-height:1.6">${message}</p>
<script>
  try { if (window.opener) window.opener.postMessage({ type: ${msgType} }, '*'); } catch (e) {}
  setTimeout(function () { try { window.close(); } catch (e) {} if (!window.closed) location.href = ${JSON.stringify(redirect)}; }, 900);
</script>
</body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": clearCookie } });
}

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const meId = guard.ctx.member.id;

  try {
    if (req.method !== "GET") return methodNotAllowed();

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    if (!code) return htmlPage("연동 코드가 없습니다. 다시 시도해주세요.", { error: true });

    // Q3-021: state 검증 (CSRF) — 쿼리 state ↔ httpOnly 쿠키 대조
    const stateParam = url.searchParams.get("state");
    const cookieHeader = req.headers.get("cookie") || "";
    const stateCookie = (cookieHeader.match(/(?:^|;\s*)gcal_oauth_state=([^;]+)/) || [])[1];
    if (!stateParam || !stateCookie || stateParam !== stateCookie) {
      return htmlPage("보안 검증(state)에 실패했습니다. 캘린더에서 다시 연동해주세요.", { error: true });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      return htmlPage("서버 설정 오류 (Google OAuth 환경변수 미설정).", { error: true });
    }

    // code → token 교환
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("[google-calendar-callback] token 교환 실패:", errText);
      return htmlPage("Google 토큰 교환에 실패했습니다. 다시 시도해주세요.", { error: true });
    }

    const tokenData: any = await tokenRes.json();
    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);

    // upsert
    const existing: any = await db
      .select({ id: googleCalendarTokens.id, refreshToken: googleCalendarTokens.refreshToken })
      .from(googleCalendarTokens)
      .where(eq(googleCalendarTokens.memberId, meId))
      .limit(1);

    if ((existing as any[]).length > 0) {
      await db
        .update(googleCalendarTokens)
        .set({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || existing[0].refreshToken,
          expiresAt,
          syncEnabled: true,
          updatedAt: new Date(),
        } as any)
        .where(eq(googleCalendarTokens.memberId, meId));
    } else {
      await db
        .insert(googleCalendarTokens)
        .values({
          memberId: meId,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || "",
          expiresAt,
          syncEnabled: true,
        } as any);
    }

    return htmlPage("구글 캘린더 연동이 완료되었습니다. 이 창은 곧 닫힙니다.");
  } catch (err: any) {
    console.error("[google-calendar-callback] error:", err);
    return htmlPage("연동 중 오류가 발생했습니다. 다시 시도해주세요.", { error: true });
  }
};

export const config = { path: "/api/google-calendar-callback" };
