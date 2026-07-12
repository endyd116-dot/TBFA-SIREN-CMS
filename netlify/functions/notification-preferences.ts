import type { Context } from "@netlify/functions";
import { jsonKST } from "../../lib/kst";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { notificationPreferences } from "../../db/schema";
import { requireActiveUser } from "../../lib/auth";
import { badRequest, serverError, corsPreflight, methodNotAllowed, parseJson } from "../../lib/response";
import { sql } from "drizzle-orm";

function jsonOk(data: object) {
  return new Response(jsonKST(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const auth = await requireActiveUser(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const user = auth.user;

  if (req.method === "GET") {
    try {
      const rows = await db
        .select({
          eventType: notificationPreferences.eventType,
          channels: notificationPreferences.channels,
        })
        .from(notificationPreferences)
        .where(eq(notificationPreferences.memberId, user.uid));

      const preferences = rows.map((r) => ({
        eventType: r.eventType,
        channels: Array.isArray(r.channels) ? r.channels : [],
      }));

      return jsonOk({ ok: true, preferences });
    } catch (err: any) {
      return serverError("알림 설정 조회 중 오류가 발생했습니다", err);
    }
  }

  if (req.method === "PUT") {
    let preferences: { eventType: string; channels: string[] }[];
    try {
      const body: any = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");
      if (!Array.isArray(body.preferences)) {
        return badRequest("preferences 배열은 필수입니다");
      }
      preferences = body.preferences;
    } catch (_) {
      return badRequest("잘못된 요청 형식입니다");
    }

    if (!preferences.length) return badRequest("preferences 배열이 비어있습니다");

    try {
      // 각 eventType에 대해 upsert: (memberId, eventType) unique index 활용
      for (const pref of preferences) {
        const eventType = String(pref.eventType || "").trim();
        const channels = Array.isArray(pref.channels) ? pref.channels : [];
        if (!eventType) continue;

        await db.execute(sql`
          INSERT INTO notification_preferences (member_id, event_type, channels, created_at, updated_at)
          VALUES (${user.uid}, ${eventType}, ${JSON.stringify(channels)}::jsonb, NOW(), NOW())
          ON CONFLICT (member_id, event_type)
          DO UPDATE SET channels = ${JSON.stringify(channels)}::jsonb, updated_at = NOW()
        `);
      }

      return jsonOk({ ok: true });
    } catch (err: any) {
      return serverError("알림 설정 저장 중 오류가 발생했습니다", err);
    }
  }

  return methodNotAllowed();
};

export const config = { path: "/api/notification-preferences" };
