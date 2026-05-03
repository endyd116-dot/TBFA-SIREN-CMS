// netlify/functions/notifications-mine.ts
// ★ Phase M-3: 사용자/관리자 통합 알림 조회
// GET /api/notifications/mine?limit=20&unreadOnly=1
// - 사용자(siren_token) → 본인 알림만
// - 관리자(siren_admin_token) → 본인(member.id) 알림 + recipientType='admin' 추가 가능

import type { Context } from "@netlify/functions";
import { eq, and, desc, gt, sql as sqlExp } from "drizzle-orm";
import { db } from "../../db";
import { notifications } from "../../db/schema";
import { authenticateUser, authenticateAdmin } from "../../lib/auth";
import { ok, unauthorized, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/notifications/mine" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const admin = authenticateAdmin(req);
  const user = !admin ? authenticateUser(req) : null;
  if (!admin && !user) return unauthorized("로그인이 필요합니다");

  const recipientId = (admin as any)?.uid || (user as any)?.uid;
  if (!recipientId) return unauthorized();

  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || 20), 50);
    const unreadOnly = url.searchParams.get("unreadOnly") === "1";

    /* 알림 목록 */
    const conds: any[] = [eq(notifications.recipientId, recipientId)];
    if (unreadOnly) conds.push(eq(notifications.isRead, false));

    const list = await db
      .select()
      .from(notifications)
      .where(and(...conds))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);

    /* 미읽음 카운트 */
    const [{ unreadCount }]: any = await db.execute(sqlExp`
      SELECT COUNT(*)::int AS "unreadCount"
      FROM notifications
      WHERE recipient_id = ${recipientId}
        AND is_read = FALSE
    `);

    /* 크리티컬 미읽음 카운트 */
    const [{ criticalCount }]: any = await db.execute(sqlExp`
      SELECT COUNT(*)::int AS "criticalCount"
      FROM notifications
      WHERE recipient_id = ${recipientId}
        AND is_read = FALSE
        AND severity = 'critical'
    `);

    return ok({
      list: list.map((n: any) => ({
        id: n.id,
        category: n.category,
        severity: n.severity,
        title: n.title,
        message: n.message,
        link: n.link,
        refTable: n.refTable,
        refId: n.refId,
        isRead: n.isRead,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
      unreadCount: unreadCount || 0,
      criticalCount: criticalCount || 0,
    });
  } catch (e: any) {
    console.error("[notifications-mine]", e);
    return serverError("알림 조회 실패", e);
  }
};