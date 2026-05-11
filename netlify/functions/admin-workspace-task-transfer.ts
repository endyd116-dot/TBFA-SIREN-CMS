/**
 * POST /api/admin-workspace-task-transfer
 *
 * 카드 토스(인계) — 본인이 현재 담당자일 때만, 다른 운영자에게 인계.
 * body: { taskId, toUid, reason? }
 *
 * 처리 단계:
 *  auth → validate → select_task → permission → transfer(이력+카드 갱신+알림+활동로그)
 */
import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { workspaceTasks, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { transferWorkspaceTask } from "../../lib/workspace-sync";

export const config = { path: "/api/admin-workspace-task-transfer" };

function jsonError(status: number, error: string, step?: string, err?: any) {
  return new Response(JSON.stringify({
    ok: false,
    error,
    step,
    detail: err ? String(err?.message || err).slice(0, 500) : undefined,
    stack: err?.stack ? String(err.stack).slice(0, 1000) : undefined,
  }), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return jsonError(405, "POST만 허용됩니다", "method");
  }

  let step = "auth";
  try {
    const guard = await requireAdmin(req);
    if (!guard.ok) return (guard as { ok: false; res: Response }).res;
    const meId = guard.ctx.member.id as number;

    step = "parse";
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonError(400, "JSON 본문 파싱 실패", step);
    }

    step = "validate";
    const taskId = Number(body?.taskId);
    const toUid  = Number(body?.toUid);
    const reason = typeof body?.reason === "string" ? body.reason : "";
    if (!Number.isFinite(taskId) || taskId <= 0) return jsonError(400, "taskId 필수", step);
    if (!Number.isFinite(toUid)  || toUid  <= 0) return jsonError(400, "toUid 필수", step);
    if (toUid === meId) return jsonError(400, "자기 자신에게는 토스할 수 없어요", step);

    step = "select_task";
    const [task]: any = await db
      .select()
      .from(workspaceTasks)
      .where(eq(workspaceTasks.id, taskId))
      .limit(1);
    if (!task) return jsonError(404, "작업을 찾을 수 없습니다", step);

    step = "permission";
    /* 본인이 현재 담당자(assignedTo) 또는 소유자(memberId) 또는 super_admin 일 때 토스 가능 */
    const isSuperAdmin = (guard.ctx.member.role || "") === "super_admin";
    const isCurrentAssignee = task.assignedTo === meId || task.memberId === meId;
    if (!isCurrentAssignee && !isSuperAdmin) {
      return jsonError(403, "현재 담당자만 토스할 수 있습니다", step);
    }
    if (task.assignedTo === toUid) {
      return jsonError(400, "이미 동일한 담당자입니다", step);
    }

    step = "validate_recipient";
    const [recipient]: any = await db
      .select({ id: members.id, name: members.name, type: members.type, status: members.status })
      .from(members)
      .where(eq(members.id, toUid))
      .limit(1);
    if (!recipient) return jsonError(404, "받는 사람을 찾을 수 없습니다", step);
    if (recipient.type !== "admin" || recipient.status !== "active") {
      return jsonError(400, "활성 상태의 운영자에게만 토스할 수 있습니다", step);
    }

    step = "transfer";
    const result = await transferWorkspaceTask({
      taskId,
      toUid,
      reason,
      transferredBy: meId,
    });
    if (!result) return jsonError(500, "토스 처리 실패", step);

    step = "respond";
    return new Response(JSON.stringify({
      ok: true,
      data: {
        transferId: result.transferId,
        fromUid: result.fromUid,
        toUid: result.toUid,
        recipientName: recipient.name,
        task: {
          id: taskId,
          assignedTo: toUid,
          assignedBy: task.assignedBy,
        },
        broadcast: { event: "task:updated", taskId },
      },
      message: `${recipient.name}님께 토스했어요`,
    }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch (err: any) {
    console.error("[admin-workspace-task-transfer] error:", err);
    return jsonError(500, "토스 처리 중 오류", step, err);
  }
};
