/**
 * 라운드 9 — 워크스페이스 서브태스크 목록 조회
 * GET /api/admin-workspace-subtasks?parentId=N  (requireAdmin)
 *
 * 응답: { ok, subtasks: [{ id, title, status, assignedTo, dueDate, progress }] }
 */
import type { Context } from "@netlify/functions";
import { eq, asc } from "drizzle-orm";
import { db, workspaceTasks } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-workspace-subtasks" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonError(status: number, step: string, error: string, detail?: any) {
  return new Response(
    JSON.stringify({ ok: false, error, step, detail: detail ? String(detail).slice(0, 500) : undefined }),
    { status, headers: JSON_HEADER }
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") return jsonError(405, "method", "GET만 허용");

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const parentId = Number(url.searchParams.get("parentId"));
  if (!Number.isFinite(parentId) || parentId <= 0) return jsonError(400, "validate", "parentId 필수");

  try {
    const rows: any = await db
      .select({
        id: workspaceTasks.id,
        title: workspaceTasks.title,
        status: workspaceTasks.status,
        assignedTo: workspaceTasks.assignedTo,
        dueDate: workspaceTasks.dueDate,
        progress: workspaceTasks.progress,
      })
      .from(workspaceTasks)
      .where(eq(workspaceTasks.parentTaskId, parentId))
      .orderBy(asc(workspaceTasks.sortOrder), asc(workspaceTasks.id))
      .limit(500);

    return new Response(
      JSON.stringify({ ok: true, subtasks: rows }),
      { status: 200, headers: JSON_HEADER }
    );
  } catch (err: any) {
    console.error("[admin-workspace-subtasks]", err);
    return jsonError(500, "select", "서브태스크 조회 실패", err?.message);
  }
};
