// netlify/functions/admin-workspace-task-watchers.ts
// ★ 2026-05-12 워크스페이스 v2 — 카드 관전자(Watcher) CRUD
//
// 관전자 = 카드 담당자는 아니지만 상태 변화를 알림으로 받고 싶은 사람.
// 예: 팀장이 팀원 카드를 관전 / 협력 운영자가 다른 부서 카드를 모니터링.
//
// GET    /api/admin/workspace-task-watchers?taskId=X
//   - 해당 카드 관전자 명단
// GET    /api/admin/workspace-task-watchers?mine=1
//   - 내가 관전 중인 카드 목록 (카드 제목·상태·담당자 join)
// POST   /api/admin/workspace-task-watchers
//   body: { taskId, memberIds: number[] }
//   - 다중 관전자 추가 (중복은 UNIQUE 제약으로 자동 무시)
// DELETE /api/admin/workspace-task-watchers?taskId=X&memberId=Y
//   - 1명 제거. 본인 관전 해제는 누구나, 타인 제거는 카드 owner/super_admin만.

import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db";
import { workspaceTaskWatchers, workspaceTasks, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/admin/workspace-task-watchers" };

function isSuperAdmin(adminMember: any): boolean {
  return adminMember && String(adminMember.role || "") === "super_admin";
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const meId = guard.ctx.admin.uid;
  const adminMember = guard.ctx.member;

  try {
    const url = new URL(req.url);

    if (req.method === "GET") {
      /* 내가 관전 중인 카드 목록 */
      if (url.searchParams.get("mine") === "1") {
        const rows: any = await db.execute(sql`
          SELECT
            w.id, w.task_id AS "taskId", w.created_at AS "watchingSince",
            t.title, t.status, t.priority, t.due_date AS "dueDate",
            t.assigned_to AS "assignedTo",
            am.name AS "assignedToName"
          FROM workspace_task_watchers w
          JOIN workspace_tasks t ON t.id = w.task_id
          LEFT JOIN members am ON am.id = t.assigned_to
          WHERE w.member_id = ${meId}
          ORDER BY t.due_date ASC, t.id DESC
          LIMIT 200
        `);
        const list = Array.isArray(rows) ? rows : (rows?.rows || []);
        return ok({ list, count: list.length });
      }

      /* 특정 카드의 관전자 명단 */
      const taskId = Number(url.searchParams.get("taskId"));
      if (!Number.isFinite(taskId)) return badRequest("taskId 또는 mine=1 필요");

      const rows: any = await db.execute(sql`
        SELECT
          w.id, w.member_id AS "memberId", w.created_at AS "createdAt",
          m.name, m.email
        FROM workspace_task_watchers w
        JOIN members m ON m.id = w.member_id
        WHERE w.task_id = ${taskId}
        ORDER BY w.created_at ASC
      `);
      const list = Array.isArray(rows) ? rows : (rows?.rows || []);
      return ok({ taskId, list, count: list.length });
    }

    if (req.method === "POST") {
      const body: any = await parseJson(req);
      const taskId = Number(body?.taskId);
      const memberIds: number[] = Array.isArray(body?.memberIds)
        ? body.memberIds.filter((x: any) => Number.isFinite(Number(x))).map(Number)
        : [];
      if (!Number.isFinite(taskId)) return badRequest("taskId 필수");
      if (!memberIds.length) return badRequest("memberIds 필수");

      /* 카드 존재 확인 */
      const [task]: any = await db.select({ id: workspaceTasks.id })
        .from(workspaceTasks).where(eq(workspaceTasks.id, taskId)).limit(1);
      if (!task) return notFound("카드를 찾을 수 없습니다");

      const inserted: number[] = [];
      for (const mid of memberIds) {
        try {
          const [row]: any = await db.insert(workspaceTaskWatchers).values({
            taskId, memberId: mid,
          } as any).returning({ id: workspaceTaskWatchers.id });
          if (row?.id) inserted.push(mid);
        } catch (_) {
          /* UNIQUE 위반 = 이미 관전 중 → 무시 */
        }
      }
      return ok({ taskId, addedMemberIds: inserted, count: inserted.length }, `관전자 ${inserted.length}명 추가`);
    }

    if (req.method === "DELETE") {
      const taskId = Number(url.searchParams.get("taskId"));
      const memberId = Number(url.searchParams.get("memberId") || meId);
      if (!Number.isFinite(taskId)) return badRequest("taskId 필수");

      /* 본인이 본인을 해제하는 건 누구나, 타인 해제는 카드 owner/super_admin만 */
      if (memberId !== meId) {
        const [task]: any = await db.select().from(workspaceTasks).where(eq(workspaceTasks.id, taskId)).limit(1);
        if (!task) return notFound("카드를 찾을 수 없습니다");
        const canRemove =
          isSuperAdmin(adminMember) ||
          task.memberId === meId ||
          task.assignedBy === meId;
        if (!canRemove) return forbidden("타인의 관전을 해제할 권한이 없습니다");
      }

      await db.delete(workspaceTaskWatchers).where(and(
        eq(workspaceTaskWatchers.taskId, taskId),
        eq(workspaceTaskWatchers.memberId, memberId),
      ));
      return ok({ taskId, memberId }, "관전 해제됨");
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-workspace-task-watchers]", e);
    return serverError("처리 실패", e?.message);
  }
};
