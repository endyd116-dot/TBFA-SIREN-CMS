// netlify/functions/cron-workspace-task-reminder.ts
// 라운드 11 — 워크스페이스 태스크 리마인더 cron (15분 주기)
//
// reminder_config JSONB 안에 remindAt(발송 예정 시각) + firedAt(발송 완료 시각) 포함.
// remindAt <= NOW()+2min 이고 firedAt 미기록인 태스크를 조회하여
// 담당자에게 WORKSPACE_ACTIVITY 알림 발송 후 firedAt 마킹.

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { dispatch } from "../../lib/notify-dispatcher";
import { NotifyEvent } from "../../lib/notify-events";

interface ReminderRow {
  id: number;
  title: string;
  assigned_to: number | null;
  member_id: number;
  reminder_config: any;
}

export default async (_req: Request, _ctx: Context) => {
  const startedAt = Date.now();
  let totalSent = 0;
  let totalSkipped = 0;

  let rows: ReminderRow[] = [];
  try {
    const res: any = await db.execute(sql`
      SELECT id, title, assigned_to, member_id, reminder_config
      FROM workspace_tasks
      WHERE status NOT IN ('done', 'archived')
        AND reminder_config->>'firedAt' IS NULL
        AND reminder_config->>'remindAt' IS NOT NULL
        AND (reminder_config->>'remindAt')::timestamptz <= NOW() + INTERVAL '2 minutes'
      LIMIT 200
    `);
    rows = (Array.isArray(res) ? res : (res as any).rows ?? []) as ReminderRow[];
  } catch (err: any) {
    console.error("[cron-task-reminder] 조회 실패:", err);
    return new Response(JSON.stringify({
      ok: false,
      error: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  for (const row of rows) {
    const recipientId = row.assigned_to ?? row.member_id;
    if (!recipientId) { totalSkipped++; continue; }

    // 알림 dispatch (fire-and-forget)
    try {
      dispatch({
        event: NotifyEvent.WORKSPACE_ACTIVITY,
        target: { type: "member", id: Number(recipientId) },
        params: {
          title: `리마인더: ${String(row.title || "").slice(0, 120)}`,
          message: "설정하신 리마인더 시각이 되었습니다.",
          link: `/workspace-kanban.html#task=${row.id}`,
          category: "reminder",
          severity: "info",
          refTable: "workspace_tasks",
          refId: row.id,
        },
      });
    } catch (dispatchErr) {
      console.warn("[cron-task-reminder] dispatch 실패 taskId=", row.id, dispatchErr);
    }

    // firedAt 마킹
    try {
      const firedAt = new Date().toISOString();
      await db.execute(sql`
        UPDATE workspace_tasks
           SET reminder_config = reminder_config || ${`{"firedAt":"${firedAt}"}`}::jsonb,
               updated_at = NOW()
         WHERE id = ${row.id}
      `);
      totalSent++;
    } catch (updateErr: any) {
      console.warn("[cron-task-reminder] firedAt 마킹 실패 taskId=", row.id, updateErr);
      totalSkipped++;
    }
  }

  const ms = Date.now() - startedAt;
  console.log("[cron-task-reminder] done", { totalSent, totalSkipped, ms });
  return new Response(JSON.stringify({
    ok: true,
    totalSent,
    totalSkipped,
    elapsedMs: ms,
  }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
};

export const config = {
  schedule: "*/15 * * * *",
};
