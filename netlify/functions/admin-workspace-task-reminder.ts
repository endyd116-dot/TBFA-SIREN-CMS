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

  const rawConfig = body.reminderConfig;

  try {
    const [task]: any = await db
      .select({
        id: workspaceTasks.id,
        dueDate: workspaceTasks.dueDate,
        memberId: workspaceTasks.memberId,
        assignedTo: workspaceTasks.assignedTo,
        assignedBy: workspaceTasks.assignedBy,
      })
      .from(workspaceTasks)
      .where(eq(workspaceTasks.id, taskId))
      .limit(1);
    if (!task) return jsonError(404, "select_task", "작업을 찾을 수 없습니다");

    /* ★ Q3-004 fix: 작업 접근 권한 검증 (메인 PATCH와 동일 — 소유/담당/지시/super) */
    const meId = auth.ctx.member.id as number;
    const isSuperAdmin = (auth.ctx.member as any).role === "super_admin";
    const canEdit = isSuperAdmin || task.memberId === meId || (task.assignedTo === meId && task.assignedBy) || task.assignedBy === meId;
    if (!canEdit) return jsonError(403, "forbidden", "이 작업을 수정할 권한이 없습니다");

    // remindAt 계산: enabled=true + minutesBefore + dueDate 모두 있을 때
    let reminderConfig = { ...rawConfig };
    if (rawConfig.enabled && rawConfig.minutesBefore && task.dueDate) {
      const remindAt = new Date(new Date(task.dueDate).getTime() - rawConfig.minutesBefore * 60 * 1000);
      reminderConfig = { ...rawConfig, remindAt: remindAt.toISOString(), firedAt: null };
    } else if (!rawConfig.enabled) {
      reminderConfig = { ...rawConfig, remindAt: null, firedAt: null };
    }

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
