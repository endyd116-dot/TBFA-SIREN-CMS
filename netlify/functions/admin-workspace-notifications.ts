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
      // Q3-019 fix: offset 페이지네이션 + 실제 총건수 반환 (기존엔 offset 미지원·total=현재페이지수라 '더 보기' 불능)
      const offsetRaw = Number(url.searchParams.get("offset"));
      const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

      step = "select_items";
      /* 2026-06-03 알림 통합: workspace_notifications + notifications 두 테이블을
         하나의 피드로 UNION. 프런트 호환 위해 키 유지(actionUrl·readAt·sentAt·category)
         + source('ws'|'notif') 추가(읽음 처리 시 대상 테이블 식별).
         [감사#84] workspace-logger.dispatch가 ws 알림을 notifications에도 복제(ref_table='workspace_notifications')
         → 두 줄·2배 카운트 방지 위해 notifications 쪽에서 그 복제분 제외. */
      const catFrag    = category   ? sql` AND category = ${category}` : sql``;
      const wsUnread   = onlyUnread ? sql` AND read_at IS NULL`        : sql``;
      const ntUnread   = onlyUnread ? sql` AND is_read = false`        : sql``;

      const feed: any = await db.execute(sql`
        SELECT * FROM (
          SELECT 'ws' AS source, id, title, body, action_url AS "actionUrl",
                 category, 'info' AS severity, read_at AS "readAt", sent_at AS "sentAt"
            FROM workspace_notifications
           WHERE member_id = ${meId}${catFrag}${wsUnread}
          UNION ALL
          SELECT 'notif' AS source, id, title, message AS body, link AS "actionUrl",
                 category, severity, read_at AS "readAt", created_at AS "sentAt"
            FROM notifications
           WHERE recipient_id = ${meId}
             AND (expires_at IS NULL OR expires_at > NOW())
             AND (ref_table IS DISTINCT FROM 'workspace_notifications')${catFrag}${ntUnread}
        ) merged
        ORDER BY "sentAt" DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
      const items = feed?.rows ?? feed ?? [];

      step = "select_unread_count";
      let unreadCount = 0;
      try {
        const cnt: any = await db.execute(sql`
          SELECT
            (SELECT COUNT(*)::int FROM workspace_notifications WHERE member_id = ${meId} AND read_at IS NULL)
          + (SELECT COUNT(*)::int FROM notifications WHERE recipient_id = ${meId} AND is_read = false
               AND (expires_at IS NULL OR expires_at > NOW())
               AND (ref_table IS DISTINCT FROM 'workspace_notifications')) AS c
        `);
        const row = Array.isArray(cnt) ? cnt[0] : (cnt as any).rows?.[0];
        unreadCount = Number(row?.c ?? 0);
      } catch (e) {
        console.warn("[notifications] unreadCount 조회 실패:", e);
      }

      // 전체 건수 (페이지네이션 '더 보기' 판단용) — 같은 필터로 두 테이블 합산
      let total = items.length;
      try {
        const tc: any = await db.execute(sql`
          SELECT
            (SELECT COUNT(*)::int FROM workspace_notifications WHERE member_id = ${meId}${catFrag}${wsUnread})
          + (SELECT COUNT(*)::int FROM notifications WHERE recipient_id = ${meId}
               AND (expires_at IS NULL OR expires_at > NOW())
               AND (ref_table IS DISTINCT FROM 'workspace_notifications')${catFrag}${ntUnread}) AS c
        `);
        const trow = Array.isArray(tc) ? tc[0] : (tc as any).rows?.[0];
        total = Number(trow?.c ?? items.length);
      } catch (e) {
        console.warn("[notifications] total 조회 실패:", e);
      }
      return jsonOk({ items, total, offset, limit, unreadCount });
    }

    /* ───── POST — 읽음 처리 ───── */
    if (req.method === "POST") {
      step = "post_parse";
      let body: any;
      try { body = await req.json(); } catch { return jsonError(400, "JSON 본문 파싱 실패", step); }

      const all = body?.all === true;
      const id = Number(body?.id);
      const source = String(body?.source || "ws");  // 'ws' | 'notif' (기본 ws=하위호환)

      step = "mark_read";
      if (all) {
        /* 알림 통합: 두 테이블 모두 읽음 처리 */
        await db.execute(sql`UPDATE workspace_notifications SET read_at = NOW() WHERE member_id = ${meId} AND read_at IS NULL`);
        await db.execute(sql`UPDATE notifications SET is_read = true, read_at = NOW() WHERE recipient_id = ${meId} AND is_read = false`);
        return jsonOk({ all: true }, "모든 알림을 읽음 처리했어요");
      }
      if (!Number.isFinite(id) || id <= 0) {
        return jsonError(400, "id 또는 all 필수", step);
      }
      /* 본인 것만 갱신 — source로 대상 테이블 식별(두 테이블 id 충돌 방지) */
      if (source === "notif") {
        await db.execute(sql`UPDATE notifications SET is_read = true, read_at = NOW() WHERE id = ${id} AND recipient_id = ${meId}`);
      } else {
        await db.execute(sql`UPDATE workspace_notifications SET read_at = NOW() WHERE id = ${id} AND member_id = ${meId}`);
      }
      return jsonOk({ id, source });
    }

    return jsonError(405, "허용되지 않은 메서드", "method");
  } catch (err: any) {
    console.error("[admin-workspace-notifications] error:", err);
    return jsonError(500, "알림 처리 중 오류", step, err);
  }
};
