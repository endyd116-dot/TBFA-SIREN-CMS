/**
 * 라운드 9 — 워크스페이스 작업 체크리스트 업데이트
 * PATCH /api/admin-workspace-task-checklist  (requireAdmin)
 *
 * checklistItems JSONB 배열 통째 교체.
 *
 * 요청: { taskId, items: [{ id, text, done, doneAt? }, ...] }
 * 응답: { ok, taskId, items: [...] }
 */
import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db, workspaceTasks } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-workspace-task-checklist" };
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
  if (!Array.isArray(body?.items)) return jsonError(400, "validate", "items 배열 필수");

  /* 항목 정규화 — id/text/done/doneAt만 유지 */
  const items = body.items.map((it: any, idx: number) => ({
    id: String(it?.id || `ck${idx + 1}`),
    text: String(it?.text || "").slice(0, 500),
    done: Boolean(it?.done),
    doneAt: it?.doneAt || (it?.done ? new Date().toISOString() : null),
  }));

  try {
    const [task]: any = await db
      .select({
        id: workspaceTasks.id,
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

    await db
      .update(workspaceTasks)
      .set({ checklistItems: items, updatedAt: new Date() } as any)
      .where(eq(workspaceTasks.id, taskId));

    return new Response(
      JSON.stringify({ ok: true, taskId, items }),
      { status: 200, headers: JSON_HEADER }
    );
  } catch (err: any) {
    console.error("[admin-workspace-task-checklist]", err);
    return jsonError(500, "update", "체크리스트 저장 실패", err?.message);
  }
};
