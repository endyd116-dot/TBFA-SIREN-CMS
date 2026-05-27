// netlify/functions/google-calendar-auth.ts
// GET /api/google-calendar-auth  : Google OAuth2 URL 생성

import { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { serverError, methodNotAllowed } from "../../lib/response";

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;

  try {
    if (req.method !== "GET") return methodNotAllowed();

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !redirectUri) {
      return serverError("Google OAuth 환경변수 미설정 (GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI)", null);
    }

    // ★ Q3-021 fix: CSRF 방지용 state nonce 발급 → httpOnly 쿠키 저장, 콜백에서 대조.
    const state = (globalThis.crypto?.randomUUID?.() || (Math.random().toString(36).slice(2) + Date.now().toString(36)));
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.readonly",
      ].join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    const secure = String(process.env.SITE_URL || "").startsWith("https") ? " Secure;" : "";
    return new Response(JSON.stringify({ ok: true, data: { authUrl } }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": `gcal_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=600`,
      },
    });
  } catch (err: any) {
    console.error("[google-calendar-auth] error:", err);
    return serverError("Google OAuth URL 생성 중 오류", err);
  }
};

export const config = { path: "/api/google-calendar-auth" };
