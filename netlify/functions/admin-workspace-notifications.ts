/**
 * /api/admin-workspace-notifications
 *
 *  GET  ?limit=10                : 본인 알림 최근 N건 + 안 읽음 수
 *       ?category=assign|due|... : 카테고리 필터
 *       ?onlyUnread=1            : 안 읽음만
 *  POST { id }                   : 단건 읽음 처리
 *  POST { all: true }            : 전체 읽음 처리
 *
 *  응답 키: actionUrl (linkUrl 아님 — 기존 workspaceNotifications 컬럼)
 *  카테고리 컬럼: category (Phase 21 R2+R3 신규)
 */
import type { Context } from "@netlify/functions";
import { and, eq, desc, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { workspaceNotifications } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-workspace-notifications" };

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;

function jsonError(status: number, error: string, step?: string, err?: any) {
  return new Response(JSON.stringify({
    ok: false, error, step,
    detail: err ? String(err?.message || err).slice(0, 500) : undefined,
    stack:  err?.stack ? String(err.stack).slice(0, 1000) : undefined,
  }), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function jsonOk(data: any, message?: string) {
  return new Response(JSON.stringify({ ok: true, message: message ?? null, data }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context) => {
  let step = "auth";
  try {
    const guard = await requireAdmin(req);
    if (!guard.ok) return (guard as { ok: false; res: Response }).res;
    const meId = guard.ctx.member.id as number;
    const url = new URL(req.url);

    /* ───── GET ───── */
    if (req.method === "GET") {
      step = "get_parse";
      const limitRaw = Number(url.searchParams.get("limit"));
      const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT));
      const category = url.searchParams.get("category");
      const onlyUnread = url.searchParams.get("onlyUnread") === "1";

      step = "select_items";
      const conditions: any[] = [eq(workspaceNotifications.memberId, meId)];
      if (category) conditions.push(eq(workspaceNotifications.category as any, category));
      if (onlyUnread) conditions.push(isNull(workspaceNotifications.readAt));

      const items = await db
        .select({
          id:         workspaceNotifications.id,
          memberId:   workspaceNotifications.memberId,
          sourceType: workspaceNotifications.sourceType,
          sourceId:   workspaceNotifications.sourceId,
          notifType:  workspaceNotifications.notifType,
          channel:    workspaceNotifications.channel,
          title:      workspaceNotifications.title,
          body:       workspaceNotifications.body,
          actionUrl:  workspaceNotifications.actionUrl,
          category:   (workspaceNotifications as any).category,
          sentAt:     workspaceNotifications.sentAt,
          readAt:     workspaceNotifications.readAt,
        })
        .from(workspaceNotifications)
        .where(and(...conditions))
        .orderBy(desc(workspaceNotifications.sentAt))
        .limit(limit);

      step = "select_unread_count";
      let unreadCount = 0;
      try {
        const cnt: any = await db.execute(sql`
          SELECT COUNT(*)::int AS c
          FROM workspace_notifications
          WHERE member_id = ${meId} AND read_at IS NULL
        `);
        const row = Array.isArray(cnt) ? cnt[0] : (cnt as any).rows?.[0];
        unreadCount = Number(row?.c ?? 0);
      } catch (e) {
        console.warn("[notifications] unreadCount 조회 실패:", e);
      }

      return jsonOk({ items, total: items.length, unreadCount });
    }

    /* ───── POST — 읽음 처리 ───── */
    if (req.method === "POST") {
      step = "post_parse";
      let body: any;
      try { body = await req.json(); } catch { return jsonError(400, "JSON 본문 파싱 실패", step); }

      const all = body?.all === true;
      const id = Number(body?.id);

      step = "mark_read";
      const now = new Date();
      if (all) {
        await db
          .update(workspaceNotifications)
          .set({ readAt: now } as any)
          .where(and(eq(workspaceNotifications.memberId, meId), isNull(workspaceNotifications.readAt)));
        return jsonOk({ all: true }, "모든 알림을 읽음 처리했어요");
      }
      if (!Number.isFinite(id) || id <= 0) {
        return jsonError(400, "id 또는 all 필수", step);
      }
      /* 본인 것만 갱신 */
      await db
        .update(workspaceNotifications)
        .set({ readAt: now } as any)
        .where(and(
          eq(workspaceNotifications.id, id),
          eq(workspaceNotifications.memberId, meId),
        ));
      return jsonOk({ id, readAt: now });
    }

    return jsonError(405, "허용되지 않은 메서드", "method");
  } catch (err: any) {
    console.error("[admin-workspace-notifications] error:", err);
    return jsonError(500, "알림 처리 중 오류", step, err);
  }
};
