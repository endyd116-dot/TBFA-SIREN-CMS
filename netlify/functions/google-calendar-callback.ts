// netlify/functions/google-calendar-callback.ts
// GET /api/google-calendar-callback?code=XXX  : OAuth 콜백 — 토큰 저장

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { googleCalendarTokens } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, serverError, methodNotAllowed } from "../../lib/response";

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const meId = guard.ctx.member.id;

  try {
    if (req.method !== "GET") return methodNotAllowed();

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    if (!code) return badRequest("code 파라미터 필수");

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      return serverError("Google OAuth 환경변수 미설정", null);
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
      return serverError("Google token 교환 실패", null);
    }

    const tokenData: any = await tokenRes.json();
    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);

    // upsert
    const existing: any = await db
      .select({ id: googleCalendarTokens.id })
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

    return ok({ connected: true });
  } catch (err: any) {
    console.error("[google-calendar-callback] error:", err);
    return serverError("Google 캘린더 연동 중 오류", err);
  }
};

export const config = { path: "/api/google-calendar-callback" };
