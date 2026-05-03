// netlify/functions/notifications-read.ts
// ★ Phase M-3: 알림 읽음 처리
// POST /api/notifications/read
//   body: { id: number }            → 단건 읽음
//   body: { ids: number[] }         → 다건 읽음
//   body: { all: true }             → 전체 읽음

import type { Context } from "@netlify/functions";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../db";
import { notifications } from "../../db/schema";
import { authenticateUser, authenticateAdmin } from "../../lib/auth";
import {
  ok, badRequest, unauthorized, serverError,
  corsPreflight, methodNotAllowed, parseJson
} from "../../lib/response";

export const config = { path: "/api/notifications/read" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const admin = authenticateAdmin(req);
  const user = !admin ? authenticateUser(req) : null;
  if (!admin && !user) return unauthorized("로그인이 필요합니다");

  const recipientId = (admin as any)?.uid || (user as any)?.uid;
  if (!recipientId) return unauthorized();

  const body = await parseJson<any>(req);
  if (!body) return badRequest("JSON 파싱 실패");

  try {
    const now = new Date();

    if (body.all === true) {
      await db.update(notifications)
        .set({ isRead: true, readAt: now } as any)
        .where(and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.isRead, false),
        ));
      return ok({ updated: "all" }, "전체 읽음 처리 완료");
    }

    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const ids = body.ids.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n));
      if (!ids.length) return badRequest("유효한 id가 없습니다");

      await db.update(notifications)
        .set({ isRead: true, readAt: now } as any)
        .where(and(
          eq(notifications.recipientId, recipientId),
          inArray(notifications.id, ids),
        ));
      return ok({ updated: ids.length }, "읽음 처리 완료");
    }

    if (Number.isFinite(Number(body.id))) {
      const id = Number(body.id);
      await db.update(notifications)
        .set({ isRead: true, readAt: now } as any)
        .where(and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.id, id),
        ));
      return ok({ updated: 1 }, "읽음 처리 완료");
    }

    return badRequest("id, ids[], 또는 all:true 중 하나가 필요합니다");
  } catch (e: any) {
    console.error("[notifications-read]", e);
    return serverError("읽음 처리 실패", e);
  }
};