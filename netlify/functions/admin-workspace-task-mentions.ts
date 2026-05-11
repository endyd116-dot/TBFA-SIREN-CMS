// netlify/functions/admin-workspace-task-mentions.ts
// ★ 2026-05-12 워크스페이스 v2 — 카드/댓글 멘션
//
// GET    /api/admin/workspace-task-mentions?unreadOnly=1
//   - 내가 멘션된 항목 + 카드 제목 join
//
// POST   /api/admin/workspace-task-mentions
//   body: { taskId?, commentId?, mentionedMemberIds: number[], message? }
//   - 멘션 INSERT × N + 각 멘션받은 사람에게 알림 발송
//
// PATCH  /api/admin/workspace-task-mentions?action=read
//   body: { ids: number[] | all: boolean }

import { eq, and, sql, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { workspaceTaskMentions, workspaceTasks, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";
import {
  ok, badRequest, serverError, parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/admin/workspace-task-mentions" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const meId = guard.ctx.admin.uid;
  const meName = guard.ctx.admin.name || "관리자";

  try {
    const url = new URL(req.url);

    if (req.method === "GET") {
      const unreadOnly = url.searchParams.get("unreadOnly") === "1";

      const rows: any = await db.execute(sql`
        SELECT
          m.id, m.task_id AS "taskId", m.comment_id AS "commentId",
          m.mentioned_by AS "mentionedBy", m.read_at AS "readAt", m.created_at AS "createdAt",
          mb.name AS "mentionerName",
          t.title AS "taskTitle"
        FROM workspace_task_mentions m
        LEFT JOIN members mb ON mb.id = m.mentioned_by
        LEFT JOIN workspace_tasks t ON t.id = m.task_id
        WHERE m.mentioned_member_id = ${meId}
        ${unreadOnly ? sql`AND m.read_at IS NULL` : sql``}
        ORDER BY m.created_at DESC
        LIMIT 100
      `);
      const list = Array.isArray(rows) ? rows : (rows?.rows || []);
      return ok({ list, count: list.length });
    }

    if (req.method === "POST") {
      const body: any = await parseJson(req);
      const taskId = body?.taskId ? Number(body.taskId) : null;
      const commentId = body?.commentId ? Number(body.commentId) : null;
      const message = (body?.message || "").toString().slice(0, 500);
      const ids: number[] = Array.isArray(body?.mentionedMemberIds)
        ? body.mentionedMemberIds.filter((x: any) => Number.isFinite(Number(x))).map(Number)
        : [];

      if (!ids.length) return badRequest("mentionedMemberIds 필수");
      if (!taskId && !commentId) return badRequest("taskId 또는 commentId 중 하나 필수");

      /* 카드 정보 — 알림용 */
      let taskTitle: string | null = null;
      if (taskId) {
        const [t]: any = await db.select({ title: workspaceTasks.title })
          .from(workspaceTasks).where(eq(workspaceTasks.id, taskId)).limit(1);
        taskTitle = t?.title || null;
      }

      const inserted: number[] = [];
      for (const memberId of ids) {
        if (memberId === meId) continue; // 자기 자신 멘션 무시
        const [row]: any = await db.insert(workspaceTaskMentions).values({
          taskId,
          commentId,
          mentionedMemberId: memberId,
          mentionedBy: meId,
        } as any).returning({ id: workspaceTaskMentions.id });
        if (row?.id) {
          inserted.push(row.id);
          /* 멘션 받은 사람에게 알림 */
          try {
            await sendWorkspaceNotification({
              memberId,
              sourceType: "task",
              sourceId: taskId || 0,
              notifType: "mention",
              channel: "bell",
              title: `📣 ${meName}님이 회원님을 언급했어요`,
              body: taskTitle ? `「${taskTitle}」${message ? " — " + message : ""}` : message || null,
              actionUrl: taskId ? `/workspace-kanban.html?taskId=${taskId}` : null,
            });
          } catch (_) {}
        }
      }

      return ok({ insertedIds: inserted, count: inserted.length }, `${inserted.length}명에게 멘션 알림`);
    }

    if (req.method === "PATCH") {
      const action = url.searchParams.get("action");
      if (action !== "read") return badRequest("action=read 필요");
      const body: any = await parseJson(req);
      const now = new Date();

      if (body?.all === true) {
        await db.update(workspaceTaskMentions)
          .set({ readAt: now } as any)
          .where(and(eq(workspaceTaskMentions.mentionedMemberId, meId), isNull(workspaceTaskMentions.readAt)));
        return ok({ marked: "all" });
      }
      const ids = Array.isArray(body?.ids) ? body.ids.filter((x: any) => Number.isFinite(Number(x))).map(Number) : [];
      if (!ids.length) return badRequest("ids 필수");
      await db.update(workspaceTaskMentions)
        .set({ readAt: now } as any)
        .where(and(eq(workspaceTaskMentions.mentionedMemberId, meId), inArray(workspaceTaskMentions.id, ids)));
      return ok({ marked: ids.length });
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-workspace-task-mentions]", e);
    return serverError("처리 실패", e?.message);
  }
};
