/**
 * netlify/functions/cron-workspace-due-reminder.ts
 *
 * 매일 KST 09:00 (UTC 00:00) 실행.
 * 마감 24시간 전 / 72시간 전 카드의 담당자·워처에게 알림 발송.
 *
 * 중복 발송 방지:
 *   같은 카드·같은 단계(24h/72h) 알림이 오늘 이미 발송됐으면 skip.
 *   workspace_notifications.title 에 단계 마커 "[D-1]" / "[D-3]" 포함 + member_id + source_id 로 체크.
 *
 * Phase 21 R2+R3 — category="due"
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";

interface DueRow {
  task_id: number;
  task_title: string;
  assignee_uid: number | null;
  due_date: Date;
}

interface ReminderStage {
  marker: "D-1" | "D-3";
  category: "due";
  hoursLow: number;
  hoursHigh: number;
}

const STAGES: ReminderStage[] = [
  { marker: "D-1", category: "due", hoursLow: 23, hoursHigh: 25 },
  { marker: "D-3", category: "due", hoursLow: 71, hoursHigh: 73 },
];

async function fetchDueTasks(stage: ReminderStage): Promise<DueRow[]> {
  const res: any = await db.execute(sql`
    SELECT id          AS task_id,
           title       AS task_title,
           assigned_to AS assignee_uid,
           due_date
    FROM workspace_tasks
    WHERE status NOT IN ('done', 'archived')
      AND due_date BETWEEN NOW() + (${stage.hoursLow}::int * INTERVAL '1 hour')
                       AND NOW() + (${stage.hoursHigh}::int * INTERVAL '1 hour')
    LIMIT 500
  `);
  return (Array.isArray(res) ? res : (res as any).rows ?? []) as DueRow[];
}

async function fetchWatcherUids(taskId: number): Promise<number[]> {
  const res: any = await db.execute(sql`
    SELECT watcher_uid FROM workspace_task_watchers WHERE task_id = ${taskId}
  `);
  const rows = Array.isArray(res) ? res : (res as any).rows ?? [];
  return rows.map((r: any) => Number(r.watcher_uid)).filter((n: number) => Number.isFinite(n) && n > 0);
}

async function alreadyNotified(taskId: number, memberId: number, marker: string): Promise<boolean> {
  /* 오늘 같은 카드·같은 단계 알림이 이미 발송됐는지 체크 (UTC 자정 기준 24h 윈도우) */
  const res: any = await db.execute(sql`
    SELECT 1
    FROM workspace_notifications
    WHERE member_id = ${memberId}
      AND source_type = 'task'
      AND source_id = ${taskId}
      AND category = 'due'
      AND title ILIKE ${"%[" + marker + "]%"}
      AND sent_at >= NOW() - INTERVAL '24 hours'
    LIMIT 1
  `);
  const rows = Array.isArray(res) ? res : (res as any).rows ?? [];
  return rows.length > 0;
}

async function sendDueReminder(opts: {
  memberId: number;
  taskId: number;
  taskTitle: string;
  marker: string;
  dueDate: Date;
  role: "assignee" | "watcher";
}): Promise<boolean> {
  if (await alreadyNotified(opts.taskId, opts.memberId, opts.marker)) return false;
  const dueStr = new Date(opts.dueDate).toISOString().slice(0, 16).replace("T", " ");
  const title = `[${opts.marker}] 마감 알림: ${opts.taskTitle.slice(0, 120)}`;
  const body = opts.role === "watcher"
    ? `(관찰자) 마감 ${opts.marker === "D-1" ? "24시간" : "72시간"} 전입니다. 마감: ${dueStr}`
    : `마감 ${opts.marker === "D-1" ? "24시간" : "72시간"} 전입니다. 마감: ${dueStr}`;
  await db.execute(sql`
    INSERT INTO workspace_notifications
      (member_id, source_type, source_id, notif_type, channel, title, body, action_url, category, delivery_status, sent_at)
    VALUES
      (${opts.memberId}, 'task', ${opts.taskId},
       ${opts.marker === "D-1" ? "reminder_1d" : "reminder_3d"},
       'bell',
       ${title},
       ${body},
       ${"/workspace-kanban.html#task=" + opts.taskId},
       'due',
       'sent',
       NOW())
  `);
  return true;
}

export default async (_req: Request, _ctx: Context) => {
  const startedAt = Date.now();
  let totalSent = 0;
  let totalSkipped = 0;
  const detail: any[] = [];

  for (const stage of STAGES) {
    let stageRows: DueRow[] = [];
    try {
      stageRows = await fetchDueTasks(stage);
    } catch (err: any) {
      console.error("[cron-due] fetchDueTasks 실패:", stage.marker, err);
      detail.push({ stage: stage.marker, error: String(err?.message || err).slice(0, 200) });
      continue;
    }

    for (const row of stageRows) {
      const recipients = new Set<number>();
      if (row.assignee_uid) recipients.add(Number(row.assignee_uid));
      try {
        const watchers = await fetchWatcherUids(Number(row.task_id));
        watchers.forEach(w => recipients.add(w));
      } catch (e) {
        console.warn("[cron-due] 워처 조회 실패:", row.task_id, e);
      }
      if (recipients.size === 0) continue;

      for (const memberId of recipients) {
        try {
          const sent = await sendDueReminder({
            memberId,
            taskId: Number(row.task_id),
            taskTitle: String(row.task_title),
            marker: stage.marker,
            dueDate: row.due_date,
            role: row.assignee_uid === memberId ? "assignee" : "watcher",
          });
          if (sent) totalSent++; else totalSkipped++;
        } catch (err) {
          console.warn("[cron-due] 알림 발송 실패:", { taskId: row.task_id, memberId, err });
        }
      }
    }
  }

  const ms = Date.now() - startedAt;
  console.log("[cron-due] done", { totalSent, totalSkipped, ms });
  return new Response(JSON.stringify({
    ok: true,
    totalSent,
    totalSkipped,
    elapsedMs: ms,
    detail,
  }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
};

/* schedule: 매일 UTC 00:00 = KST 09:00. path 금지 (Netlify Scheduled Function 제약) */
export const config = {
  schedule: "0 0 * * *",
};
