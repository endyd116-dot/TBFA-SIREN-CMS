// netlify/functions/admin-task-due-changes.ts
// Phase 3 Step 2-B — 마감일 변경 요청 + 승인 흐름
//
// 정책:
//   - 본인 task (assignedBy IS NULL): /admin-workspace-tasks에서 직접 dueDate 변경 (미래 확장)
//   - 지시받은 task: 반드시 이 API로 요청 → super_admin 또는 assignedBy가 승인/반려
//
// GET ?list=1&status=pending  : 승인 대기 (super_admin 또는 나와 관련된 것)
// GET ?list=1&mine=1          : 내가 요청한 이력
// GET ?id=N                   : 단일
// POST { taskId, newDue, reason } : 요청 생성
// PATCH ?id=N&action=approve  : 승인 → tasks.dueDate 업데이트
// PATCH ?id=N&action=reject   : 반려

import { Context } from "@netlify/functions";
import { db } from "../../db";
import {
  workspaceTasks,
  taskDueChangeRequests,
  members,
} from "../../db/schema";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, methodNotAllowed, serverError,
  notFound, forbidden, parseJson,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";
import {
  logWorkspaceActivity,
  sendWorkspaceNotification,
} from "../../lib/workspace-logger";

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const adminMember = guard.ctx.member;
  const meId = adminMember.id;
  const isSuperAdmin = (adminMember as any).role === "super_admin";

  const url = new URL(req.url);

  try {
    /* ════════════════════════════════════════════
       GET
    ════════════════════════════════════════════ */
    if (req.method === "GET") {
      const id = url.searchParams.get("id");
      const listFlag = url.searchParams.get("list");

      // ─── 단일 조회 ───
      if (id) {
        const rowId = Number(id);
        if (!rowId) return badRequest("id가 유효하지 않습니다");

        const [request]: any = await db
          .select()
          .from(taskDueChangeRequests)
          .where(eq(taskDueChangeRequests.id, rowId))
          .limit(1);
        if (!request) return notFound("요청을 찾을 수 없습니다");

        // 관련 task
        const [task]: any = await db
          .select()
          .from(workspaceTasks)
          .where(eq(workspaceTasks.id, request.taskId))
          .limit(1);

        // 권한: 요청자 / task의 assignedBy / super_admin
        const canView =
          isSuperAdmin ||
          request.requestedBy === meId ||
          (task && task.assignedBy === meId);
        if (!canView) return forbidden("조회 권한이 없습니다");

        const [requester]: any = await db
          .select({ name: members.name })
          .from(members)
          .where(eq(members.id, request.requestedBy))
          .limit(1);
        const [reviewer]: any = request.reviewedBy
          ? await db
              .select({ name: members.name })
              .from(members)
              .where(eq(members.id, request.reviewedBy))
              .limit(1)
          : [null];

        return ok({
          ...request,
          task: task || null,
          _computed: {
            requesterName: requester?.name || null,
            reviewerName: reviewer?.name || null,
          },
        });
      }

      // ─── 목록 ───
      if (listFlag === "1") {
        const status = url.searchParams.get("status");
        const mine = url.searchParams.get("mine") === "1";
        const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);

        const conds: any[] = [];

        if (mine) {
          conds.push(eq(taskDueChangeRequests.requestedBy, meId));
        } else if (!isSuperAdmin) {
          // 일반 관리자: 내가 요청한 것 + 내가 지시한 task의 요청
          const myAssignedTaskIds: any = await db
            .select({ id: workspaceTasks.id })
            .from(workspaceTasks)
            .where(eq(workspaceTasks.assignedBy, meId));
          const taskIds = myAssignedTaskIds.map((t: any) => t.id);
          if (taskIds.length > 0) {
            conds.push(or(
              eq(taskDueChangeRequests.requestedBy, meId),
              sql`${taskDueChangeRequests.taskId} = ANY(${taskIds})`
            ));
          } else {
            conds.push(eq(taskDueChangeRequests.requestedBy, meId));
          }
        }
        // super_admin은 전체 조회

        if (status) conds.push(eq(taskDueChangeRequests.status, status));

        const whereClause = conds.length ? and(...conds) : undefined;

        const items: any = await db
          .select()
          .from(taskDueChangeRequests)
          .where(whereClause as any)
          .orderBy(
            sql`CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END`,
            desc(taskDueChangeRequests.createdAt)
          )
          .limit(limit);

        return ok({ items, total: items.length });
      }

      return badRequest("list=1 또는 id=N 필수");
    }

    /* ════════════════════════════════════════════
       POST — 요청 생성
    ════════════════════════════════════════════ */
    if (req.method === "POST") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("JSON body 필요");
      if (!body.taskId) return badRequest("taskId 필수");
      if (!body.newDue) return badRequest("newDue 필수");
      if (!body.reason || !body.reason.trim()) return badRequest("reason 필수");

      const taskId = Number(body.taskId);
      const newDue = new Date(body.newDue);
      if (isNaN(newDue.getTime())) return badRequest("newDue 형식 오류");

      const [task]: any = await db
        .select()
        .from(workspaceTasks)
        .where(eq(workspaceTasks.id, taskId))
        .limit(1);
      if (!task) return notFound("작업을 찾을 수 없습니다");

      // 권한: 지시받은 본인만 요청 가능
      if (task.assignedTo !== meId || !task.assignedBy) {
        return forbidden("지시받은 작업의 수행자만 마감일 변경을 요청할 수 있습니다");
      }

      // 중복 요청 차단 (pending 있으면 거부)
      const [existing]: any = await db
        .select()
        .from(taskDueChangeRequests)
        .where(and(
          eq(taskDueChangeRequests.taskId, taskId),
          eq(taskDueChangeRequests.status, "pending")
        ))
        .limit(1);
      if (existing) {
        return badRequest("이미 대기 중인 변경 요청이 있습니다");
      }

      const [newRequest]: any = await db
        .insert(taskDueChangeRequests)
        .values({
          taskId,
          requestedBy: meId,
          currentDue: task.dueDate,
          newDue,
          reason: body.reason.trim(),
          status: "pending",
        } as any)
        .returning();

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.due.request",
        target: `due_request:${newRequest.id}`,
        detail: { taskId, newDue: newDue.toISOString(), reason: body.reason }, req,
      });

      await logWorkspaceActivity({
        actorId: meId,
        actorName: adminMember.name,
        actionType: "due.request",
        targetType: "due_request",
        targetId: newRequest.id,
        targetTitle: `${task.title} 마감일 변경 요청`,
        metadata: {
          taskId,
          currentDue: task.dueDate,
          newDue: newDue.toISOString(),
        },
        visibility: "team",
      });

      // 지시자(승인권자)에게 알림
      if (task.assignedBy) {
        await sendWorkspaceNotification({
          memberId: task.assignedBy,
          sourceType: "due_change",
          sourceId: newRequest.id,
          notifType: "assigned",
          channel: "bell",
          title: `마감일 변경 요청: ${task.title}`,
          body: `${new Date(task.dueDate).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} → ${newDue.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}\n사유: ${body.reason}`,
          actionUrl: `/workspace-kanban.html#task=${taskId}`,  // [감사#29] 죽은 해시 → 작업 카드(승인권자 검토)
        });
      }

      return ok(newRequest, "마감일 변경이 요청되었습니다");
    }

    /* ════════════════════════════════════════════
       PATCH — 승인/반려
    ════════════════════════════════════════════ */
    if (req.method === "PATCH") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id 필수");
      const action = url.searchParams.get("action");
      const body: any = await parseJson(req);
      if (!body) return badRequest("JSON body 필요");

      if (!["approve", "reject", "cancel"].includes(action || "")) {
        return badRequest("action은 approve | reject | cancel");
      }

      const [request]: any = await db
        .select()
        .from(taskDueChangeRequests)
        .where(eq(taskDueChangeRequests.id, id))
        .limit(1);
      if (!request) return notFound("요청을 찾을 수 없습니다");
      if (request.status !== "pending") {
        return badRequest(`이미 처리된 요청입니다 (status=${request.status})`);
      }

      const [task]: any = await db
        .select()
        .from(workspaceTasks)
        .where(eq(workspaceTasks.id, request.taskId))
        .limit(1);
      if (!task) return notFound("관련 작업이 삭제되었습니다");

      /* OP-049: 요청자 본인이 pending 요청을 취소 — 잘못 올린 요청에 갇히지 않고 재요청 가능하게.
         (취소는 승인권자가 아니라 요청자 권한) */
      if (action === "cancel") {
        if (request.requestedBy !== meId) return forbidden("본인이 요청한 건만 취소할 수 있습니다");
        const [cancelled]: any = await db
          .update(taskDueChangeRequests)
          .set({ status: "cancelled", reviewedBy: meId, reviewedAt: new Date() } as any)
          .where(eq(taskDueChangeRequests.id, id))
          .returning();
        await logWorkspaceActivity({
          actorId: meId,
          actorName: adminMember.name,
          actionType: "due.cancel",
          targetType: "due_request",
          targetId: id,
          targetTitle: `${task.title} 마감일 변경 요청 취소`,
          metadata: { taskId: request.taskId },
          visibility: "team",
        });
        return ok(cancelled, "요청이 취소되었습니다");
      }

      // 권한: super_admin 또는 task.assignedBy
      if (!isSuperAdmin && task.assignedBy !== meId) {
        return forbidden("승인 권한이 없습니다");
      }

      if (action === "reject" && (!body.reviewNote || !body.reviewNote.trim())) {
        return badRequest("반려 시 reviewNote 필수");
      }

      // 요청 업데이트
      const newStatus = action === "approve" ? "approved" : "rejected";
      const [updated]: any = await db
        .update(taskDueChangeRequests)
        .set({
          status: newStatus,
          reviewedBy: meId,
          reviewedAt: new Date(),
          reviewNote: body.reviewNote || null,
        } as any)
        .where(eq(taskDueChangeRequests.id, id))
        .returning();

      // 승인 시 실제 task의 dueDate 업데이트
      if (action === "approve") {
        await db
          .update(workspaceTasks)
          .set({
            dueDate: request.newDue,
            updatedAt: new Date(),
          } as any)
          .where(eq(workspaceTasks.id, request.taskId));
      }

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: action === "approve" ? "workspace.due.approve" : "workspace.due.reject",
        target: `due_request:${id}`,
        detail: { taskId: request.taskId, reviewNote: body.reviewNote }, req,
      });

      await logWorkspaceActivity({
        actorId: meId,
        actorName: adminMember.name,
        actionType: action === "approve" ? "due.approve" : "due.reject",
        targetType: "due_request",
        targetId: id,
        targetTitle: `${task.title} 마감일 변경 ${action === "approve" ? "승인" : "반려"}`,
        metadata: {
          taskId: request.taskId,
          approved: action === "approve",
          newDue: request.newDue,
          reviewNote: body.reviewNote,
        },
        visibility: "team",
      });

      // 요청자에게 결과 알림
      await sendWorkspaceNotification({
        memberId: request.requestedBy,
        sourceType: "due_change",
        sourceId: id,
        notifType: action === "approve" ? "approved" : "rejected",
        channel: "bell",
        title: action === "approve"
          ? `마감일 변경 승인: ${task.title}`
          : `마감일 변경 반려: ${task.title}`,
        body: action === "approve"
          ? `새 마감일: ${new Date(request.newDue).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`
          : `사유: ${body.reviewNote || ""}`,
        actionUrl: `/workspace-kanban.html#task=${request.taskId}`,  // [감사#29] 죽은 해시 정정
      });

      return ok(updated, action === "approve" ? "승인되었습니다" : "반려되었습니다");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-task-due-changes] error:", err);
    return serverError("마감일 변경 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin-task-due-changes" };
