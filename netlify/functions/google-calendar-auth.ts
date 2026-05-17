// netlify/functions/google-calendar-auth.ts
// GET /api/google-calendar-auth  : Google OAuth2 URL 생성

import { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, serverError, methodNotAllowed } from "../../lib/response";

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
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return ok({ authUrl });
  } catch (err: any) {
    console.error("[google-calendar-auth] error:", err);
    return serverError("Google OAuth URL 생성 중 오류", err);
  }
};

export const config = { path: "/api/google-calendar-auth" };
