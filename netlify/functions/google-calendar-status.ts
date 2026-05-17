// netlify/functions/google-calendar-status.ts
// GET /api/google-calendar-status  : 현재 연동 상태 조회

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { googleCalendarTokens } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, methodNotAllowed, serverError } from "../../lib/response";

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const meId = guard.ctx.member.id;

  try {
    if (req.method !== "GET") return methodNotAllowed();

    const [token]: any = await db
      .select()
      .from(googleCalendarTokens)
      .where(eq(googleCalendarTokens.memberId, meId))
      .limit(1);

    if (!token) {
      return ok({ connected: false, calendarId: null, lastSyncAt: null });
    }

    return ok({
      connected: !!token.syncEnabled,
      calendarId: token.calendarId || "primary",
      lastSyncAt: token.lastSyncAt,
    });
  } catch (err: any) {
    console.error("[google-calendar-status] error:", err);
    return serverError("Google 캘린더 상태 조회 중 오류", err);
  }
};

export const config = { path: "/api/google-calendar-status" };
