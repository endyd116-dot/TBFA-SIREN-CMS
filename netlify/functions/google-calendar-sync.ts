// netlify/functions/google-calendar-sync.ts
// POST /api/google-calendar-sync  : 워크스페이스 이벤트 → Google 캘린더 동기화

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { googleCalendarTokens, workspaceEvents } from "../../db/schema";
import { eq, and, gte } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, serverError, methodNotAllowed } from "../../lib/response";
import { parseJson } from "../../lib/response";

async function refreshAccessToken(token: any): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: token.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("token refresh 실패");
  const data: any = await res.json();
  // 만료 시간 갱신
  await db
    .update(googleCalendarTokens)
    .set({
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
      updatedAt: new Date(),
    } as any)
    .where(eq(googleCalendarTokens.memberId, token.memberId));
  return data.access_token;
}

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const meId = guard.ctx.member.id;

  try {
    if (req.method !== "POST") return methodNotAllowed();

    const body: any = await parseJson(req);
    // 토큰 조회
    const [token]: any = await db
      .select()
      .from(googleCalendarTokens)
      .where(eq(googleCalendarTokens.memberId, meId))
      .limit(1);

    if (!token) return badRequest("Google 캘린더 연동이 필요합니다 (/api/google-calendar-auth 먼저 호출)");
    if (!token.syncEnabled) return badRequest("동기화가 비활성화 상태입니다");

    // 만료 시 재발급
    let accessToken = token.accessToken;
    if (new Date(token.expiresAt) <= new Date()) {
      accessToken = await refreshAccessToken(token);
    }

    const calendarId = token.calendarId || "primary";

    // 앞으로 90일 이내 본인 이벤트 조회
    const since = new Date();
    const events: any = await db
      .select()
      .from(workspaceEvents)
      .where(
        and(
          eq(workspaceEvents.memberId, meId),
          gte(workspaceEvents.startAt, since)
        )
      )
      .limit(200);

    let synced = 0;
    let failed = 0;

    const createUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const authHeaders = { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" };

    for (const ev of events as any[]) {
      try {
        const gEvent = {
          summary: ev.title,
          description: ev.description || "",
          start: ev.allDay
            ? { date: new Date(ev.startAt).toISOString().slice(0, 10) }
            : { dateTime: new Date(ev.startAt).toISOString() },
          end: ev.allDay
            ? { date: new Date(ev.endAt || ev.startAt).toISOString().slice(0, 10) }
            : { dateTime: new Date(ev.endAt || ev.startAt).toISOString() },
          location: ev.location || "",
        };

        // [감사#19] externalRef(구글 event id)가 있으면 PATCH(수정), 없으면 POST(생성) 후 id 저장
        //   → 동기화를 반복해도 같은 일정이 중복 생성되지 않음. 구글에서 삭제됐으면(404/410) 재생성.
        let gcRes: Response;
        let newExternalRef: string | null = null;
        if (ev.externalRef) {
          gcRes = await fetch(`${createUrl}/${encodeURIComponent(ev.externalRef)}`, {
            method: "PATCH", headers: authHeaders, body: JSON.stringify(gEvent),
          });
          if (gcRes.status === 404 || gcRes.status === 410) {
            gcRes = await fetch(createUrl, { method: "POST", headers: authHeaders, body: JSON.stringify(gEvent) });
            if (gcRes.ok) { const c: any = await gcRes.json().catch(() => ({})); newExternalRef = c?.id || null; }
          }
        } else {
          gcRes = await fetch(createUrl, { method: "POST", headers: authHeaders, body: JSON.stringify(gEvent) });
          if (gcRes.ok) { const c: any = await gcRes.json().catch(() => ({})); newExternalRef = c?.id || null; }
        }

        if (gcRes.ok) {
          synced++;
          if (newExternalRef) {
            await db.update(workspaceEvents)
              .set({ externalRef: newExternalRef, updatedAt: new Date() } as any)
              .where(eq(workspaceEvents.id, ev.id));
          }
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    // lastSyncAt 갱신
    await db
      .update(googleCalendarTokens)
      .set({ lastSyncAt: new Date(), updatedAt: new Date() } as any)
      .where(eq(googleCalendarTokens.memberId, meId));

    return ok({ synced, failed, total: (events as any[]).length });
  } catch (err: any) {
    console.error("[google-calendar-sync] error:", err);
    return serverError("Google 캘린더 동기화 중 오류", err);
  }
};

export const config = { path: "/api/google-calendar-sync" };
