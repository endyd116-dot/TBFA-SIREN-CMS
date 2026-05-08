// netlify/functions/admin-daily-briefing.ts
// ★ Phase 3 Step 2-B — 일일 브리핑 조회 API
//
// ⚠️ 브리핑 생성은 Step 5의 Agent-8 cron이 담당. 이 API는 조회/읽음만.
//
// GET ?today=1            : 오늘 브리핑
// GET ?date=YYYY-MM-DD    : 특정 날짜
// GET ?list=1&limit=30    : 최근 목록
// GET ?list=1&unread=1    : 안 읽은 것만
// GET ?stats=1            : 대시보드용 실시간 통계 (DB 저장 X)
// PATCH ?id=N&action=read : 읽음 처리

import { Context } from "@netlify/functions";
import { db } from "../../db";
import {
  dailyBriefings,
  workspaceTasks,
  workspaceEvents,
  workspaceNotifications,
} from "../../db/schema";
import { eq, and, desc, asc, sql, isNull } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, methodNotAllowed, serverError,
  notFound, parseJson,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const adminMember = guard.ctx.member;
  const meId = adminMember.id;

  const url = new URL(req.url);

  try {
    /* ════════════════════════════════════════════
       GET
    ════════════════════════════════════════════ */
    if (req.method === "GET") {
      const id = url.searchParams.get("id");
      const today = url.searchParams.get("today");
      const date = url.searchParams.get("date");
      const listFlag = url.searchParams.get("list");
      const statsFlag = url.searchParams.get("stats");

      // ─── 대시보드용 실시간 통계 (DB 저장 없이 즉시 계산) ───
      if (statsFlag === "1") {
        const now = new Date();
        const kstOffsetMs = 9 * 60 * 60 * 1000;
        const kstNow = new Date(now.getTime() + kstOffsetMs);
        const kstToday = new Date(kstNow);
        kstToday.setHours(0, 0, 0, 0);
        const kstTomorrow = new Date(kstToday);
        kstTomorrow.setDate(kstTomorrow.getDate() + 1);
        const kstDayAfter = new Date(kstTomorrow);
        kstDayAfter.setDate(kstDayAfter.getDate() + 1);
        const kstYesterday = new Date(kstToday);
        kstYesterday.setDate(kstYesterday.getDate() - 1);

        const stats: any = await db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE (member_id=${meId} OR assigned_to=${meId}) AND status!='done' AND due_date < now()) AS overdue,
            COUNT(*) FILTER (WHERE (member_id=${meId} OR assigned_to=${meId}) AND status!='done' AND due_date >= ${kstToday.toISOString()} AND due_date < ${kstTomorrow.toISOString()}) AS today_due,
            COUNT(*) FILTER (WHERE (member_id=${meId} OR assigned_to=${meId}) AND status!='done' AND due_date >= ${kstTomorrow.toISOString()} AND due_date < ${kstDayAfter.toISOString()}) AS tomorrow_due,
            COUNT(*) FILTER (WHERE (member_id=${meId} OR assigned_to=${meId}) AND status='doing') AS in_progress,
            COUNT(*) FILTER (WHERE (member_id=${meId} OR assigned_to=${meId}) AND priority='urgent' AND status!='done') AS urgent,
            COUNT(*) FILTER (WHERE assigned_to=${meId} AND assigned_by IS NOT NULL AND status='todo') AS inbox,
            COUNT(*) FILTER (WHERE completed_by=${meId} AND completed_at >= ${kstYesterday.toISOString()} AND completed_at < ${kstToday.toISOString()}) AS completed_yesterday
          FROM workspace_tasks
        `);
        const row = (Array.isArray(stats) ? stats[0] : (stats as any).rows?.[0]) || {};

        const eventStats: any = await db.execute(sql`
          SELECT COUNT(*) AS today_events
          FROM workspace_events
          WHERE (member_id=${meId} OR attendees @> ${JSON.stringify([{ memberId: meId }])}::jsonb)
            AND start_at >= ${kstToday.toISOString()}
            AND start_at < ${kstTomorrow.toISOString()}
        `);
        const evRow = (Array.isArray(eventStats) ? eventStats[0] : (eventStats as any).rows?.[0]) || {};

        const unreadNotifStats: any = await db.execute(sql`
          SELECT COUNT(*) AS cnt
          FROM workspace_notifications
          WHERE member_id=${meId} AND read_at IS NULL
        `);
        const notifRow = (Array.isArray(unreadNotifStats) ? unreadNotifStats[0] : (unreadNotifStats as any).rows?.[0]) || {};

        return ok({
          overdueCount: Number(row.overdue || 0),
          todayDueCount: Number(row.today_due || 0),
          tomorrowDueCount: Number(row.tomorrow_due || 0),
          inProgressCount: Number(row.in_progress || 0),
          urgentCount: Number(row.urgent || 0),
          inboxCount: Number(row.inbox || 0),
          completedYesterdayCount: Number(row.completed_yesterday || 0),
          todayEventsCount: Number(evRow.today_events || 0),
          unreadNotifCount: Number(notifRow.cnt || 0),
          timestamp: new Date().toISOString(),
        });
      }

      // ─── 단일 조회 (id) ───
      if (id) {
        const rowId = Number(id);
        if (!rowId) return badRequest("id가 유효하지 않습니다");

        const [briefing]: any = await db
          .select()
          .from(dailyBriefings)
          .where(and(
            eq(dailyBriefings.id, rowId),
            eq(dailyBriefings.memberId, meId)
          ))
          .limit(1);
        if (!briefing) return notFound("브리핑을 찾을 수 없습니다");
        return ok(briefing);
      }

      // ─── 특정 날짜 (today=1 또는 date=YYYY-MM-DD) ───
      if (today === "1" || date) {
        let targetDate: Date;
        if (today === "1") {
          const now = new Date();
          targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else {
          targetDate = new Date(date!);
          if (isNaN(targetDate.getTime())) return badRequest("date 형식 오류 (YYYY-MM-DD)");
          targetDate.setHours(0, 0, 0, 0);
        }

        const [briefing]: any = await db
          .select()
          .from(dailyBriefings)
          .where(and(
            eq(dailyBriefings.memberId, meId),
            eq(dailyBriefings.briefingDate, targetDate)
          ))
          .limit(1);

        if (!briefing) {
          return ok({
            exists: false,
            briefingDate: targetDate.toISOString().slice(0, 10),
            message: "아직 브리핑이 생성되지 않았습니다 (Agent-8이 매일 새벽 생성)",
          });
        }
        return ok({ exists: true, ...briefing });
      }

      // ─── 목록 ───
      if (listFlag === "1") {
        const unread = url.searchParams.get("unread");
        const limit = Math.min(Number(url.searchParams.get("limit") || 30), 100);

        const conds: any[] = [eq(dailyBriefings.memberId, meId)];
        if (unread === "1") conds.push(isNull(dailyBriefings.readAt));

        const items: any = await db
          .select()
          .from(dailyBriefings)
          .where(and(...conds))
          .orderBy(desc(dailyBriefings.briefingDate))
          .limit(limit);

        return ok({ items, total: items.length });
      }

      return badRequest("today=1 / date=YYYY-MM-DD / list=1 / stats=1 / id=N 중 하나 필수");
    }

    /* ════════════════════════════════════════════
       PATCH — 읽음 처리
    ════════════════════════════════════════════ */
    if (req.method === "PATCH") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id 필수");
      const action = url.searchParams.get("action");
      if (action !== "read") return badRequest("action=read 만 지원");

      const [briefing]: any = await db
        .select()
        .from(dailyBriefings)
        .where(and(
          eq(dailyBriefings.id, id),
          eq(dailyBriefings.memberId, meId)
        ))
        .limit(1);
      if (!briefing) return notFound("브리핑을 찾을 수 없습니다");

      if (briefing.readAt) {
        return ok(briefing, "이미 읽음 처리됨");
      }

      const [updated]: any = await db
        .update(dailyBriefings)
        .set({ readAt: new Date() })
        .where(eq(dailyBriefings.id, id))
        .returning();

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.briefing.read",
        target: `briefing:${id}`,
        detail: { briefingDate: briefing.briefingDate }, req,
      });

      return ok(updated, "읽음 처리 완료");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-daily-briefing] error:", err);
    return serverError("브리핑 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin-daily-briefing" };
