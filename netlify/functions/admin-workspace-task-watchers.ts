/**
 * /api/admin-workspace-task-watchers
 *
 * 카드 워처 (관찰자) — 본인만 자기 자신을 등록·해제.
 *  GET    ?taskId=N        : 워처 목록 (이름 포함) + 본인 등록 여부
 *  POST   { taskId }       : 본인 워처 등록 (UNIQUE 충돌 시 idempotent)
 *  DELETE ?taskId=N        : 본인 워처 해제
 */
import type { Context } from "@netlify/functions";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  workspaceTaskWatchers,
  workspaceTasks,
  members,
} from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-workspace-task-watchers" };

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

    /* ───── GET — 워처 목록 + 본인 등록 여부 ───── */
    if (req.method === "GET") {
      step = "get_validate";
      const taskId = Number(url.searchParams.get("taskId"));
      if (!Number.isFinite(taskId) || taskId <= 0) return jsonError(400, "taskId 필수", step);

      step = "select_watchers";
      const rows = await db
        .select({
          id:         workspaceTaskWatchers.id,
          watcherUid: workspaceTaskWatchers.watcherUid,
          addedAt:    workspaceTaskWatchers.addedAt,
          name:       members.name,
        })
        .from(workspaceTaskWatchers)
        .leftJoin(members, eq(workspaceTaskWatchers.watcherUid, members.id))
        .where(eq(workspaceTaskWatchers.taskId, taskId));

      const isWatching = rows.some(r => r.watcherUid === meId);
      return jsonOk({ items: rows, total: rows.length, isWatching });
    }

    /* ───── POST — 본인 등록 ───── */
    if (req.method === "POST") {
      step = "post_parse";
      let body: any;
      try { body = await req.json(); } catch { return jsonError(400, "JSON 본문 파싱 실패", step); }
      const taskId = Number(body?.taskId);
      if (!Number.isFinite(taskId) || taskId <= 0) return jsonError(400, "taskId 필수", step);

      step = "select_task";
      const [task]: any = await db.select({ id: workspaceTasks.id })
        .from(workspaceTasks).where(eq(workspaceTasks.id, taskId)).limit(1);
      if (!task) return jsonError(404, "작업을 찾을 수 없습니다", step);

      step = "insert_watcher_idempotent";
      /* UNIQUE(task_id, watcher_uid) 위반 시 ON CONFLICT DO NOTHING 효과 */
      await db.execute(sql`
        INSERT INTO workspace_task_watchers (task_id, watcher_uid)
        VALUES (${taskId}, ${meId})
        ON CONFLICT (task_id, watcher_uid) DO NOTHING
      `);
      return jsonOk({ taskId, watcherUid: meId, isWatching: true }, "이 작업을 관찰합니다");
    }

    /* ───── DELETE — 본인 해제 ───── */
    if (req.method === "DELETE") {
      step = "delete_validate";
      const taskId = Number(url.searchParams.get("taskId"));
      if (!Number.isFinite(taskId) || taskId <= 0) return jsonError(400, "taskId 필수", step);

      step = "delete_watcher";
      await db
        .delete(workspaceTaskWatchers)
        .where(and(
          eq(workspaceTaskWatchers.taskId, taskId),
          eq(workspaceTaskWatchers.watcherUid, meId),
        ));
      return jsonOk({ taskId, watcherUid: meId, isWatching: false }, "관찰을 해제했어요");
    }

    return jsonError(405, "허용되지 않은 메서드", "method");
  } catch (err: any) {
    console.error("[admin-workspace-task-watchers] error:", err);
    return jsonError(500, "워처 처리 중 오류", step, err);
  }
};
