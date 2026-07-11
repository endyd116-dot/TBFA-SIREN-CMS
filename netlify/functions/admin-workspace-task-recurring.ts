/**
 * 라운드 9 — 워크스페이스 작업 반복 생성
 * POST /api/admin-workspace-task-recurring  (requireAdmin)
 *
 * 원본 작업을 복제해 새 마감일로 별도 task 생성. recurringParentId = parentTaskId.
 *
 * 요청: { parentTaskId, title?, dueDate }
 * 응답: { ok, id, recurringParentId }
 */
import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db, workspaceTasks } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-workspace-task-recurring" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonError(status: number, step: string, error: string, detail?: any) {
  return new Response(
    JSON.stringify({ ok: false, error, step, detail: detail ? String(detail).slice(0, 500) : undefined }),
    { status, headers: JSON_HEADER }
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return jsonError(405, "method", "POST만 허용");

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  const meId = auth.ctx.member.id as number;

  let body: any;
  try {
    body = await req.json();
  } catch (e: any) {
    return jsonError(400, "parse", "JSON 본문 파싱 실패", e?.message);
  }

  const parentTaskId = Number(body?.parentTaskId);
  if (!Number.isFinite(parentTaskId) || parentTaskId <= 0) return jsonError(400, "validate", "parentTaskId 필수");

  const dueDateRaw = body?.dueDate;
  if (!dueDateRaw) return jsonError(400, "validate", "dueDate 필수");
  const dueDate = new Date(dueDateRaw);
  if (isNaN(dueDate.getTime())) return jsonError(400, "validate", "dueDate 형식 오류");

  try {
    /* 원본 작업 조회 */
    const [parent]: any = await db
      .select()
      .from(workspaceTasks)
      .where(eq(workspaceTasks.id, parentTaskId))
      .limit(1);
    if (!parent) return jsonError(404, "select_parent", "원본 작업을 찾을 수 없습니다");

    /* Q3-004 fix: 원본 작업 접근 권한 검증 (메인 PATCH와 동일 — 소유/담당/지시/super) */
    const isSuperAdmin = (auth.ctx.member as any).role === "super_admin";
    const canEdit = isSuperAdmin || parent.memberId === meId || (parent.assignedTo === meId && parent.assignedBy) || parent.assignedBy === meId;
    if (!canEdit) return jsonError(403, "forbidden", "이 작업을 반복 생성할 권한이 없습니다");

    const rawTitle = String(body?.title || parent.title || "").trim() || parent.title;
    const title = rawTitle.startsWith("[반복] ") ? rawTitle : `[반복] ${rawTitle}`;

    const insertData: any = {
      memberId: meId,
      title,
      description: parent.description ?? null,
      status: "todo",
      priority: parent.priority || "normal",
      dueDate,
      assignedBy: meId,
      assignedTo: parent.assignedTo ?? null,
      assignedAt: parent.assignedTo ? new Date() : null,
      tags: parent.tags ?? [],
      checklistItems: parent.checklistItems ?? [],
      reminderConfig: parent.reminderConfig ?? {},
      recurringParentId: parentTaskId,
      sourceType: "recurring",
      sourceId: parentTaskId,
      createdByAgent: "user",
    };

    const [created]: any = await db.insert(workspaceTasks).values(insertData).returning();

    return new Response(
      JSON.stringify({ ok: true, id: created.id, recurringParentId: parentTaskId }),
      { status: 200, headers: JSON_HEADER }
    );
  } catch (err: any) {
    console.error("[admin-workspace-task-recurring]", err);
    return jsonError(500, "insert", "반복 작업 생성 실패", err?.message);
  }
};
