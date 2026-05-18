/**
 * 라운드 9 — 워크스페이스 작업 리마인더 설정
 * PATCH /api/admin-workspace-task-reminder  (requireAdmin)
 *
 * reminderConfig JSONB 통째 교체.
 *
 * 요청: { taskId, reminderConfig: { enabled, minutesBefore?, channels?: [...] } }
 * 응답: { ok, taskId }
 */
import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db, workspaceTasks } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-workspace-task-reminder" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonError(status: number, step: string, error: string, detail?: any) {
  return new Response(
    JSON.stringify({ ok: false, error, step, detail: detail ? String(detail).slice(0, 500) : undefined }),
    { status, headers: JSON_HEADER }
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "PATCH") return jsonError(405, "method", "PATCH만 허용");

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  let body: any;
  try {
    body = await req.json();
  } catch (e: any) {
    return jsonError(400, "parse", "JSON 본문 파싱 실패", e?.message);
  }

  const taskId = Number(body?.taskId);
  if (!Number.isFinite(taskId) || taskId <= 0) return jsonError(400, "validate", "taskId 필수");
  if (!body?.reminderConfig || typeof body.reminderConfig !== "object") {
    return jsonError(400, "validate", "reminderConfig 객체 필수");
  }

  const reminderConfig = body.reminderConfig;

  try {
    const [task]: any = await db
      .select({ id: workspaceTasks.id })
      .from(workspaceTasks)
      .where(eq(workspaceTasks.id, taskId))
      .limit(1);
    if (!task) return jsonError(404, "select_task", "작업을 찾을 수 없습니다");

    await db
      .update(workspaceTasks)
      .set({ reminderConfig, updatedAt: new Date() } as any)
      .where(eq(workspaceTasks.id, taskId));

    return new Response(
      JSON.stringify({ ok: true, taskId }),
      { status: 200, headers: JSON_HEADER }
    );
  } catch (err: any) {
    console.error("[admin-workspace-task-reminder]", err);
    return jsonError(500, "update", "리마인더 저장 실패", err?.message);
  }
};
