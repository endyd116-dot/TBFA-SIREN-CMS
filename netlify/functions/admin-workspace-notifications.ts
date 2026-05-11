// netlify/functions/admin-workspace-notifications.ts
// ★ 2026-05-12 워크스페이스 v2 — 알림 통합 (카테고리 탭 + 미확인 카운트)
//
// 라우트
//   GET    /api/admin/workspace-notifications?tab=all|assign|due|mention|system&limit=50
//     - 본인(memberId=meId)에게 온 알림만 + 카테고리 자동 분류
//     - 응답: { items, unreadCount, unreadByTab, generatedAt }
//
//   POST   /api/admin/workspace-notifications?action=read
//     body: { ids?: number[], all?: boolean, tab?: string }
//     - 특정 ID들 / 전체 / 카테고리별 일괄 읽음 처리
//
//   GET    /api/admin/workspace-notifications?action=unread-count
//     - 벨 배지용 빠른 카운트만 (캐싱 부담 줄임)

import { eq, and, sql, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { workspaceNotifications } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, serverError, parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/admin/workspace-notifications" };

/* notifType → 카테고리 매핑 */
function categorize(notifType: string, sourceType: string): "assign" | "due" | "mention" | "system" {
  const t = String(notifType || "");
  if (t === "assigned" || t === "transferred" || t === "fallback_backup") return "assign";
  if (t.startsWith("reminder_") || t === "overdue" || t === "sla_warning") return "due";
  if (t === "mention" || t === "comment") return "mention";
  return "system";
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const meId = guard.ctx.admin.uid;

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    /* ===== 빠른 미확인 카운트 ===== */
    if (req.method === "GET" && action === "unread-count") {
      const r: any = await db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM workspace_notifications
        WHERE member_id = ${meId} AND read_at IS NULL
      `);
      const cnt = (Array.isArray(r) ? r[0] : r.rows?.[0])?.cnt || 0;
      return ok({ unreadCount: cnt });
    }

    /* ===== 목록 조회 ===== */
    if (req.method === "GET") {
      const tab = (url.searchParams.get("tab") || "all").toLowerCase();
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);

      const list: any = await db.execute(sql`
        SELECT
          id, source_type AS "sourceType", source_id AS "sourceId",
          notif_type AS "notifType", channel, title, body,
          action_url AS "actionUrl", sent_at AS "sentAt", read_at AS "readAt"
        FROM workspace_notifications
        WHERE member_id = ${meId}
        ORDER BY sent_at DESC, id DESC
        LIMIT ${limit * 4}
      `);
      const rows = (Array.isArray(list) ? list : (list?.rows || [])) as any[];

      /* 카테고리 분류 */
      const annotated = rows.map((r: any) => ({
        ...r,
        category: categorize(r.notifType, r.sourceType),
        unread: !r.readAt,
      }));

      const items = tab === "all" ? annotated : annotated.filter((r: any) => r.category === tab);
      const trimmed = items.slice(0, limit);

      /* 카테고리별 미확인 카운트 */
      const unreadByTab: Record<string, number> = { all: 0, assign: 0, due: 0, mention: 0, system: 0 };
      annotated.forEach((r: any) => {
        if (r.unread) {
          unreadByTab.all++;
          unreadByTab[r.category] = (unreadByTab[r.category] || 0) + 1;
        }
      });

      return ok({
        items: trimmed,
        unreadCount: unreadByTab.all,
        unreadByTab,
        tab,
        generatedAt: new Date().toISOString(),
      });
    }

    /* ===== 읽음 처리 ===== */
    if (req.method === "POST" && action === "read") {
      const body: any = await parseJson(req);
      const now = new Date();

      if (body?.all === true) {
        const tabFilter = body?.tab;
        if (tabFilter && tabFilter !== "all") {
          /* 카테고리별 일괄 — DB 차원에서 notif_type 매칭으로 처리 */
          let typeFilter: string[] = [];
          if (tabFilter === "assign") typeFilter = ["assigned", "transferred", "fallback_backup"];
          else if (tabFilter === "due") typeFilter = ["reminder_3d", "reminder_1d", "reminder_2h", "overdue", "sla_warning"];
          else if (tabFilter === "mention") typeFilter = ["mention", "comment"];

          if (typeFilter.length) {
            await db.execute(sql`
              UPDATE workspace_notifications
              SET read_at = ${now}
              WHERE member_id = ${meId} AND read_at IS NULL
                AND notif_type = ANY(${typeFilter}::varchar[])
            `);
          } else {
            /* system 탭: 위 매칭에 해당하지 않는 모든 알림 */
            await db.execute(sql`
              UPDATE workspace_notifications
              SET read_at = ${now}
              WHERE member_id = ${meId} AND read_at IS NULL
                AND notif_type NOT IN ('assigned','transferred','fallback_backup','reminder_3d','reminder_1d','reminder_2h','overdue','sla_warning','mention','comment')
            `);
          }
        } else {
          await db.update(workspaceNotifications)
            .set({ readAt: now } as any)
            .where(and(eq(workspaceNotifications.memberId, meId), isNull(workspaceNotifications.readAt)));
        }
        return ok({ marked: "all", tab: tabFilter || "all" }, "모두 읽음 처리되었습니다");
      }

      const ids = Array.isArray(body?.ids) ? body.ids.filter((x: any) => Number.isFinite(Number(x))).map(Number) : [];
      if (!ids.length) return badRequest("ids 또는 all=true 중 하나 필요");

      await db.update(workspaceNotifications)
        .set({ readAt: now } as any)
        .where(and(
          eq(workspaceNotifications.memberId, meId),
          inArray(workspaceNotifications.id, ids),
        ));

      return ok({ marked: ids.length }, `${ids.length}건 읽음 처리`);
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-workspace-notifications]", e);
    return serverError("처리 실패", e?.message);
  }
};
