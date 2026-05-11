// netlify/functions/cron-workspace-sla.ts
// ★ 2026-05-12 워크스페이스 v2 — SLA 자동 체크 + 단계별 마감 알림
//
// 매 30분 주기로 실행. 다음 3가지 시점 모두 1회씩만 알림:
//   - SLA / 마감일 12시간 전  → reminder_12h
//   - SLA / 마감일 2시간 전   → reminder_2h
//   - SLA / 마감일 초과       → overdue
//
// 알림 발송 후 workspace_tasks.remindersSentAt(jsonb 배열)에 발송 단계 기록 → 재발송 차단.
//
// 알림 받는 사람: assignedTo (현재 담당자) + watchers (관전자 전원)

import { eq, sql, and, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { workspaceTasks, workspaceTaskWatchers } from "../../db/schema";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

/* Netlify Scheduled Functions: 매 30분
   주의: schedule 함수는 path를 지정하면 안 됨 (Netlify 제약).
   함수 이름(cron-workspace-sla)으로 자동 라우팅됨 */
export const config = {
  schedule: "*/30 * * * *",
};

const STAGES = [
  { key: "reminder_12h", offsetMs: 12 * 60 * 60 * 1000, label: "12시간 전" },
  { key: "reminder_2h",  offsetMs: 2 * 60 * 60 * 1000,  label: "2시간 전" },
  { key: "overdue",      offsetMs: 0,                     label: "마감 초과" },
];

async function getWatcherIds(taskId: number): Promise<number[]> {
  try {
    const rows: any = await db.execute(sql`
      SELECT member_id AS "memberId" FROM workspace_task_watchers WHERE task_id = ${taskId}
    `);
    const list = Array.isArray(rows) ? rows : (rows?.rows || []);
    return list.map((r: any) => Number(r.memberId)).filter(Boolean);
  } catch (_) {
    return [];
  }
}

export default async (_req: Request) => {
  const summary: Record<string, number> = { scanned: 0, notified: 0, errors: 0 };

  try {
    /* 마감일 또는 SLA 임박/초과 + 미완료(done/archived 제외) 카드 후보 */
    const now = new Date();
    const horizonEnd = new Date(now.getTime() + 12 * 60 * 60 * 1000 + 30 * 60 * 1000); // 12.5h 후까지

    const rows: any = await db.execute(sql`
      SELECT id, title, due_date AS "dueDate", assigned_to AS "assignedTo",
             member_id AS "memberId", status, priority,
             reminders_sent_at AS "remindersSentAt",
             source_type AS "sourceType", source_id AS "sourceId"
      FROM workspace_tasks
      WHERE status NOT IN ('done','archived')
        AND due_date IS NOT NULL
        AND due_date <= ${horizonEnd}
      ORDER BY due_date ASC
      LIMIT 500
    `);
    const candidates = (Array.isArray(rows) ? rows : (rows?.rows || [])) as any[];
    summary.scanned = candidates.length;

    for (const task of candidates) {
      const due = task.dueDate ? new Date(task.dueDate) : null;
      if (!due) continue;
      const msUntilDue = due.getTime() - now.getTime();
      const sentList: string[] = Array.isArray(task.remindersSentAt) ? task.remindersSentAt : [];

      /* 가장 적합한 단계 결정 (가장 임박한 단계 우선) */
      let triggered: { key: string; label: string } | null = null;
      if (msUntilDue <= 0 && !sentList.includes("overdue")) {
        triggered = { key: "overdue", label: "⛔ 마감 초과" };
      } else if (msUntilDue > 0 && msUntilDue <= STAGES[1].offsetMs && !sentList.includes("reminder_2h")) {
        triggered = { key: "reminder_2h", label: "⏰ 마감 2시간 전" };
      } else if (msUntilDue > STAGES[1].offsetMs && msUntilDue <= STAGES[0].offsetMs && !sentList.includes("reminder_12h")) {
        triggered = { key: "reminder_12h", label: "🕒 마감 12시간 전" };
      }
      if (!triggered) continue;

      /* 수신자 = 담당자 + 카드 소유자 + 관전자 */
      const recipientSet = new Set<number>();
      if (task.assignedTo) recipientSet.add(Number(task.assignedTo));
      if (task.memberId) recipientSet.add(Number(task.memberId));
      const watchers = await getWatcherIds(task.id);
      watchers.forEach((m) => recipientSet.add(m));

      for (const memberId of recipientSet) {
        try {
          await sendWorkspaceNotification({
            memberId,
            sourceType: "task",
            sourceId: task.id,
            notifType: triggered.key,
            channel: "bell",
            title: `${triggered.label} — ${task.title}`,
            body: `마감: ${due.toISOString().replace("T", " ").slice(0, 16)}`,
            actionUrl: `/workspace-kanban.html?taskId=${task.id}`,
          });
          summary.notified++;
        } catch (_) {
          summary.errors++;
        }
      }

      /* 발송 단계 기록 (재발송 차단) */
      const newList = Array.from(new Set([...sentList, triggered.key]));
      await db.update(workspaceTasks)
        .set({ remindersSentAt: newList } as any)
        .where(eq(workspaceTasks.id, task.id));
    }

    return new Response(JSON.stringify({ ok: true, ...summary, generatedAt: now.toISOString() }, null, 2), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[cron-workspace-sla]", e);
    return new Response(JSON.stringify({
      ok: false, error: String(e?.message || e).slice(0, 500), summary,
    }, null, 2), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
