/**
 * Phase 3 Step 7-C.2 — AI-2 작업 리스크 점수 일일 cron
 *
 * 매일 KST 06:30 (UTC 21:30) 실행 — Agent-8(06:00)의 30분 후
 *
 * 동작:
 *   1. 활성 task(status NOT IN done/archived) + dueDate 7일 이내 또는 진행률 50% 미만
 *   2. calculateTaskRisk(taskId) 순회 호출
 *   3. ai_risk_score 갱신
 *   4. 점수 70+ 인 작업의 소유자/지시자에게 알림 (workspace_notifications)
 *
 * 멤버별 격리, 실패해도 다음 진행. 동시 호출 제한 (배치 5개씩).
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { workspaceTasks, members } from "../../db/schema";
import { sql, and, or, eq, lt, lte, ne, inArray } from "drizzle-orm";
import { calculateTaskRisk } from "../../lib/ai-task";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

const BATCH_SIZE = 5;        // 동시 처리 수
const HIGH_RISK_THRESHOLD = 70;
const MAX_TASKS_PER_RUN = 200;

export default async (_req: Request, _ctx: Context) => {
  const start = Date.now();
  console.info("[cron-task-risk] 시작", new Date().toISOString());

  try {
    // 활성 task 후보군 조회 (done/archived 제외, 7일 이내 마감 또는 진행률 50% 미만)
    const sevenDaysLater = new Date();
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

    const candidates: any = await db.execute(sql`
      SELECT id, title, member_id, assigned_to, assigned_by, priority, due_date, progress, status
      FROM workspace_tasks
      WHERE status NOT IN ('done', 'archived')
        AND (
          due_date <= ${sevenDaysLater.toISOString()}
          OR progress < 50
          OR priority = 'urgent'
          OR status = 'blocked'
        )
      ORDER BY due_date ASC
      LIMIT ${MAX_TASKS_PER_RUN}
    `);
    const tasks = (Array.isArray(candidates) ? candidates : (candidates as any).rows || []) as any[];

    if (!tasks.length) {
      console.info("[cron-task-risk] 후보 task 없음 — 종료");
      return new Response(
        JSON.stringify({ ok: true, processed: 0, message: "후보 없음" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    let success = 0;
    const errors: Array<{ taskId: number; error: string }> = [];
    const highRisk: Array<{ taskId: number; score: number; ownerId: number | null; assignedTo: number | null; title: string }> = [];

    // 배치 처리
    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (t) => {
          const r = await calculateTaskRisk(Number(t.id));
          if (r.ok && typeof r.score === "number") {
            return { taskId: Number(t.id), score: r.score, task: t };
          }
          throw new Error(r.error || "unknown");
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          success++;
          if (r.value.score >= HIGH_RISK_THRESHOLD) {
            highRisk.push({
              taskId: r.value.taskId,
              score: r.value.score,
              ownerId: r.value.task.member_id,
              assignedTo: r.value.task.assigned_to,
              title: r.value.task.title,
            });
          }
        } else {
          errors.push({ taskId: -1, error: String(r.reason).slice(0, 200) });
        }
      }
    }

    // 고위험 알림 발송 (소유자 + 지시받은자)
    let notifSent = 0;
    for (const h of highRisk) {
      const targets = new Set<number>();
      if (h.ownerId) targets.add(h.ownerId);
      if (h.assignedTo && h.assignedTo !== h.ownerId) targets.add(h.assignedTo);

      for (const memberId of targets) {
        try {
          await sendWorkspaceNotification({
            memberId,
            sourceType: "task",
            sourceId: h.taskId,
            notifType: "overdue",
            channel: "bell",
            title: `지연 위험 ${h.score}점: ${h.title}`,
            body: `AI가 지연 가능성을 ${h.score}/100점으로 평가했습니다. 마감 일정을 점검해 주세요.`,
            actionUrl: `/workspace-kanban.html#task=${h.taskId}`,
          });
          notifSent++;
        } catch (err) {
          console.warn("[cron-task-risk] 알림 실패:", err);
        }
      }
    }

    const durationMs = Date.now() - start;
    console.info(`[cron-task-risk] 완료 ${success}/${tasks.length}건, 고위험 ${highRisk.length}, 알림 ${notifSent} (${durationMs}ms)`);

    return new Response(
      JSON.stringify({
        ok: true,
        total: tasks.length,
        success,
        failed: errors.length,
        highRiskCount: highRisk.length,
        notificationsSent: notifSent,
        durationMs,
        errors: errors.slice(0, 5),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[cron-task-risk] fatal:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "unknown" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config = {
  schedule: "30 21 * * *", // UTC 21:30 = KST 06:30 (Agent-8 06:00의 30분 후)
};
