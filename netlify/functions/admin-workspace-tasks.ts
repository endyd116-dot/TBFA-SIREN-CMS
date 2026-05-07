// netlify/functions/admin-workspace-tasks.ts
// ★ Phase 3 Step 2-A — 워크스페이스 Task CRUD API
//
// GET ?list=1         : 목록 (filters: status/mine/assignedToMe/dueBefore/q/sourceType/sourceId)
// GET ?id=N           : 단일 상세
// GET ?stats=1        : 내 통계
// GET ?feed=1         : 팀 활동 피드
// POST                : 생성
// PATCH ?id=N         : 일반 수정 (dueDate 제외)
// PATCH ?id=N&action=status    : 상태만
// PATCH ?id=N&action=checklist : 체크리스트 토글
// PATCH ?id=N&action=assign    : 재지시
// DELETE ?id=N        : 삭제 (본인 task + super_admin만)

import { Context } from "@netlify/functions";
import { db } from "../../db";
import {
  workspaceTasks,
  workspaceActivityLog,
  members,
} from "../../db/schema";
import { eq, and, or, desc, asc, sql, lte, gte, isNull, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, methodNotAllowed, serverError,
  notFound, forbidden, parseJson,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";
import {
  logWorkspaceActivity,
  sendWorkspaceNotification,
  logTaskChange,
} from "../../lib/workspace-logger";

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.res;
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
      const statsFlag = url.searchParams.get("stats");
      const feedFlag = url.searchParams.get("feed");

      // ─── 팀 활동 피드 ───
      if (feedFlag === "1") {
        const limit = Math.min(Number(url.searchParams.get("limit") || 30), 100);
        const feed: any = await db
          .select()
          .from(workspaceActivityLog)
          .where(
            or(
              eq(workspaceActivityLog.visibility, "team"),
              eq(workspaceActivityLog.visibility, "public")
            )
          )
          .orderBy(desc(workspaceActivityLog.createdAt))
          .limit(limit);
        return ok({ items: feed });
      }

      // ─── 통계 ───
      if (statsFlag === "1") {
        const myScope = or(
          eq(workspaceTasks.memberId, meId),
          eq(workspaceTasks.assignedTo, meId)
        );
        const rows: any = await db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE status='todo') AS todo_count,
            COUNT(*) FILTER (WHERE status='doing') AS doing_count,
            COUNT(*) FILTER (WHERE status='done') AS done_count,
            COUNT(*) FILTER (WHERE status='blocked') AS blocked_count,
            COUNT(*) FILTER (WHERE status!='done' AND due_date < now()) AS overdue_count,
            COUNT(*) FILTER (WHERE status!='done' AND due_date >= now() AND due_date < now() + interval '1 day') AS due_today_count,
            COUNT(*) FILTER (WHERE status!='done' AND due_date >= now() + interval '1 day' AND due_date < now() + interval '2 day') AS due_tomorrow_count,
            COUNT(*) FILTER (WHERE assigned_to = ${meId} AND assigned_by IS NOT NULL AND status='todo') AS inbox_count,
            COUNT(*) FILTER (WHERE priority='urgent' AND status!='done') AS urgent_count
          FROM workspace_tasks
          WHERE member_id=${meId} OR assigned_to=${meId}
        `);
        const row = (Array.isArray(rows) ? rows[0] : (rows as any).rows?.[0]) || {};
        return ok({
          todoCount: Number(row.todo_count || 0),
          doingCount: Number(row.doing_count || 0),
          doneCount: Number(row.done_count || 0),
          blockedCount: Number(row.blocked_count || 0),
          overdueCount: Number(row.overdue_count || 0),
          dueTodayCount: Number(row.due_today_count || 0),
          dueTomorrowCount: Number(row.due_tomorrow_count || 0),
          inboxCount: Number(row.inbox_count || 0),
          urgentCount: Number(row.urgent_count || 0),
        });
      }

      // ─── 단일 조회 ───
      if (id) {
        const rowId = Number(id);
        if (!rowId) return badRequest("id가 유효하지 않습니다");

        const [task]: any = await db
          .select()
          .from(workspaceTasks)
          .where(eq(workspaceTasks.id, rowId))
          .limit(1);

        if (!task) return notFound("작업을 찾을 수 없습니다");

        // 권한 체크: 본인/지시받은/지시자/super_admin만 조회 가능
        const canView =
          isSuperAdmin ||
          task.memberId === meId ||
          task.assignedTo === meId ||
          task.assignedBy === meId ||
          task.completedBy === meId;
        if (!canView) return forbidden("조회 권한이 없습니다");

        // 관련 멤버 이름 조회
        const memberIds = [
          task.memberId, task.assignedBy, task.assignedTo, task.completedBy,
        ].filter((v): v is number => !!v);
        const memberList: any = memberIds.length
          ? await db
              .select({ id: members.id, name: members.name })
              .from(members)
              .where(sql`${members.id} = ANY(${memberIds})`)
          : [];
        const memberMap: Record<number, string> = {};
        for (const m of memberList) memberMap[m.id] = m.name;

        return ok({
          ...task,
          _computed: {
            ownerName: memberMap[task.memberId] || null,
            assignedByName: task.assignedBy ? memberMap[task.assignedBy] : null,
            assignedToName: task.assignedTo ? memberMap[task.assignedTo] : null,
            completedByName: task.completedBy ? memberMap[task.completedBy] : null,
            isMine: task.memberId === meId,
            isAssignedToMe: task.assignedTo === meId && !!task.assignedBy,
            canEditDueDate: task.memberId === meId && !task.assignedBy,
          },
        });
      }

      // ─── 목록 ───
      if (listFlag === "1") {
        const status = url.searchParams.get("status");
        const mine = url.searchParams.get("mine") === "1";
        const assignedToMe = url.searchParams.get("assignedToMe") === "1";
        const dueBefore = url.searchParams.get("dueBefore");
        const q = url.searchParams.get("q");
        const sourceType = url.searchParams.get("sourceType");
        const sourceId = url.searchParams.get("sourceId");
        const priority = url.searchParams.get("priority");
        const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);

        const conds: any[] = [];

        // 스코프: 기본은 본인 관련
        if (assignedToMe) {
          conds.push(and(eq(workspaceTasks.assignedTo, meId), isNotNull(workspaceTasks.assignedBy)));
        } else if (mine || !isSuperAdmin) {
          conds.push(or(eq(workspaceTasks.memberId, meId), eq(workspaceTasks.assignedTo, meId)));
        }

        if (status) conds.push(eq(workspaceTasks.status, status));
        if (priority) conds.push(eq(workspaceTasks.priority, priority));
        if (dueBefore) conds.push(lte(workspaceTasks.dueDate, new Date(dueBefore)));
        if (q) {
          conds.push(or(
            sql`${workspaceTasks.title} ILIKE ${"%" + q + "%"}`,
            sql`${workspaceTasks.description} ILIKE ${"%" + q + "%"}`
          ));
        }
        if (sourceType) conds.push(eq(workspaceTasks.sourceType, sourceType));
        if (sourceId) conds.push(eq(workspaceTasks.sourceId, Number(sourceId)));

        const whereClause = conds.length ? and(...conds) : undefined;

        const items: any = await db
          .select()
          .from(workspaceTasks)
          .where(whereClause as any)
          .orderBy(
            sql`CASE status WHEN 'blocked' THEN 0 WHEN 'doing' THEN 1 WHEN 'todo' THEN 2 WHEN 'done' THEN 3 ELSE 4 END`,
            asc(workspaceTasks.dueDate)
          )
          .limit(limit);

        return ok({ items, total: items.length });
      }

      return badRequest("list=1 / id=N / stats=1 / feed=1 중 하나 필수");
    }

    /* ════════════════════════════════════════════
       POST — 신규 생성
    ════════════════════════════════════════════ */
    if (req.method === "POST") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("JSON body 필요");
      if (!body.title || typeof body.title !== "string") return badRequest("title 필수");
      if (!body.dueDate) return badRequest("dueDate 필수");

      const dueDateObj = new Date(body.dueDate);
      if (isNaN(dueDateObj.getTime())) return badRequest("dueDate 형식 오류");

      const assignedTo: number | null = body.assignedTo ? Number(body.assignedTo) : null;
      const ownerMemberId = assignedTo ?? meId;
      const isAssignment = !!assignedTo && assignedTo !== meId;

      // assignedTo가 실제 존재하는 admin인지 검증
      if (isAssignment) {
        const [target]: any = await db
          .select({ id: members.id, type: members.type, name: members.name })
          .from(members)
          .where(eq(members.id, assignedTo))
          .limit(1);
        if (!target) return badRequest("지시 대상 운영자를 찾을 수 없습니다");
        if (target.type !== "admin") return badRequest("관리자에게만 지시할 수 있습니다");
      }

      const [newTask]: any = await db
        .insert(workspaceTasks)
        .values({
          memberId: ownerMemberId,
          title: body.title.trim().slice(0, 300),
          description: body.description || null,
          status: body.status || "todo",
          priority: body.priority || "normal",
          dueDate: dueDateObj,
          assignedBy: isAssignment ? meId : null,
          assignedTo: isAssignment ? assignedTo : null,
          assignedAt: isAssignment ? new Date() : null,
          parentTaskId: body.parentTaskId || null,
          tags: Array.isArray(body.tags) ? body.tags : [],
          sortOrder: body.sortOrder || 0,
          progress: 0,
          sourceType: body.sourceType || "manual",
          sourceId: body.sourceId || null,
          sourceRefUrl: body.sourceRefUrl || null,
          checklistItems: Array.isArray(body.checklistItems) ? body.checklistItems : [],
          attachments: Array.isArray(body.attachments) ? body.attachments : [],
          reminderConfig: body.reminderConfig || {},
          remindersSentAt: [],
          createdByAgent: body.createdByAgent || "user",
        })
        .returning();

      // 감사 로그
      await logAudit({
        userId: meId,
        userType: "admin",
        userName: adminMember.name,
        action: "workspace.task.create",
        target: `task:${newTask.id}`,
        detail: { title: newTask.title, assignedTo, priority: newTask.priority },
        req,
      });

      // Activity Log + 알림 (지시 시 대상에게)
      await logTaskChange({
        actorId: meId,
        actorName: adminMember.name,
        taskId: newTask.id,
        taskTitle: newTask.title,
        actionType: isAssignment ? "task.assign" : "task.create",
        metadata: { priority: newTask.priority, dueDate: newTask.dueDate, isAssignment },
        notifyMemberIds: isAssignment ? [assignedTo!] : [],
        notifyType: "assigned",
        notifyTitle: `📋 새 작업이 지시되었습니다: ${newTask.title}`,
        notifyBody: `마감: ${dueDateObj.toLocaleString("ko-KR")}`,
        actionUrl: `/admin#task-${newTask.id}`,
      });

      return ok(newTask, "작업이 생성되었습니다");
    }

    /* ════════════════════════════════════════════
       PATCH — 수정
    ════════════════════════════════════════════ */
    if (req.method === "PATCH") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id 필수");
      const action = url.searchParams.get("action");
      const body: any = await parseJson(req);
      if (!body) return badRequest("JSON body 필요");

      const [task]: any = await db
        .select()
        .from(workspaceTasks)
        .where(eq(workspaceTasks.id, id))
        .limit(1);
      if (!task) return notFound("작업을 찾을 수 없습니다");

      const isOwner = task.memberId === meId;
      const isAssignee = task.assignedTo === meId && task.assignedBy;
      const isAssigner = task.assignedBy === meId;
      const canEdit = isSuperAdmin || isOwner || isAssignee || isAssigner;
      if (!canEdit) return forbidden("수정 권한이 없습니다");

      /* ─── action=status ─── */
      if (action === "status") {
        const newStatus = body.status;
        if (!["todo", "doing", "done", "blocked"].includes(newStatus)) {
          return badRequest("status 값 오류 (todo/doing/done/blocked)");
        }
        const updateData: any = {
          status: newStatus,
          updatedAt: new Date(),
        };
        if (newStatus === "done") {
          updateData.completedAt = new Date();
          updateData.completedBy = meId;
          updateData.progress = 100;
        } else if (task.status === "done" && newStatus !== "done") {
          updateData.completedAt = null;
          updateData.completedBy = null;
        }

        const [updated]: any = await db
          .update(workspaceTasks)
          .set(updateData)
          .where(eq(workspaceTasks.id, id))
          .returning();

        // 알림 대상: 지시자 또는 소유자 (본인 제외)
        const notifyTargets = new Set<number>();
        if (task.assignedBy && task.assignedBy !== meId) notifyTargets.add(task.assignedBy);
        if (task.memberId !== meId) notifyTargets.add(task.memberId);

        await logTaskChange({
          actorId: meId,
          actorName: adminMember.name,
          taskId: id,
          taskTitle: task.title,
          actionType: newStatus === "done" ? "task.complete" : "task.status",
          metadata: { prevStatus: task.status, newStatus },
          notifyMemberIds: Array.from(notifyTargets),
          notifyType: newStatus === "done" ? "completed" : "status_changed",
          notifyTitle: newStatus === "done"
            ? `✅ 작업 완료: ${task.title}`
            : `🔄 상태 변경(${newStatus}): ${task.title}`,
          actionUrl: `/admin#task-${id}`,
        });

        await logAudit({
          userId: meId, userType: "admin", userName: adminMember.name,
          action: "workspace.task.status", target: `task:${id}`,
          detail: { prev: task.status, next: newStatus }, req,
        });
        return ok(updated, "상태가 변경되었습니다");
      }

      /* ─── action=checklist ─── */
      if (action === "checklist") {
        const itemId = body.itemId;
        const done = !!body.done;
        if (!itemId) return badRequest("itemId 필수");

        const items = Array.isArray(task.checklistItems) ? [...task.checklistItems] : [];
        let found = false;
        for (const item of items) {
          if (item.id === itemId) {
            item.done = done;
            item.doneAt = done ? new Date().toISOString() : null;
            found = true;
            break;
          }
        }
        if (!found) return notFound("체크리스트 항목을 찾을 수 없습니다");

        // 진행도 자동 계산
        const total = items.length;
        const doneCount = items.filter((i: any) => i.done).length;
        const progress = total > 0 ? Math.round((doneCount / total) * 100) : 0;

        const [updated]: any = await db
          .update(workspaceTasks)
          .set({ checklistItems: items, progress, updatedAt: new Date() })
          .where(eq(workspaceTasks.id, id))
          .returning();

        await logWorkspaceActivity({
          actorId: meId,
          actorName: adminMember.name,
          actionType: "task.checklist.toggle",
          targetType: "task",
          targetId: id,
          targetTitle: task.title,
          metadata: { itemId, done, progress },
          visibility: "team",
        });

        return ok(updated);
      }

      /* ─── action=assign ─── */
      if (action === "assign") {
        const newAssignee = body.assignedTo ? Number(body.assignedTo) : null;
        if (!newAssignee) return badRequest("assignedTo 필수");
        if (!isOwner && !isAssigner && !isSuperAdmin) {
          return forbidden("지시 권한이 없습니다");
        }

        const [target]: any = await db
          .select({ id: members.id, type: members.type })
          .from(members)
          .where(eq(members.id, newAssignee))
          .limit(1);
        if (!target || target.type !== "admin") {
          return badRequest("관리자에게만 지시할 수 있습니다");
        }

        const [updated]: any = await db
          .update(workspaceTasks)
          .set({
            memberId: newAssignee,
            assignedTo: newAssignee,
            assignedBy: meId,
            assignedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(workspaceTasks.id, id))
          .returning();

        await logTaskChange({
          actorId: meId,
          actorName: adminMember.name,
          taskId: id,
          taskTitle: task.title,
          actionType: "task.assign",
          metadata: { prevAssignee: task.assignedTo, newAssignee },
          notifyMemberIds: [newAssignee],
          notifyType: "assigned",
          notifyTitle: `📋 새 작업이 지시되었습니다: ${task.title}`,
          actionUrl: `/admin#task-${id}`,
        });

        return ok(updated, "지시가 완료되었습니다");
      }

      /* ─── 일반 PATCH (dueDate 제외) ─── */
      if (body.dueDate !== undefined) {
        return badRequest("마감일 변경은 /admin/task-due-changes API를 사용하세요");
      }

      const updateData: any = { updatedAt: new Date() };
      if (body.title !== undefined) updateData.title = String(body.title).trim().slice(0, 300);
      if (body.description !== undefined) updateData.description = body.description;
      if (body.priority !== undefined) updateData.priority = body.priority;
      if (body.tags !== undefined && Array.isArray(body.tags)) updateData.tags = body.tags;
      if (body.progress !== undefined) {
        const p = Number(body.progress);
        if (p < 0 || p > 100) return badRequest("progress는 0~100");
        updateData.progress = p;
      }
      if (body.checklistItems !== undefined && Array.isArray(body.checklistItems)) {
        updateData.checklistItems = body.checklistItems;
      }
      if (body.attachments !== undefined && Array.isArray(body.attachments)) {
        updateData.attachments = body.attachments;
      }
      if (body.reminderConfig !== undefined) updateData.reminderConfig = body.reminderConfig;
      if (body.sortOrder !== undefined) updateData.sortOrder = Number(body.sortOrder);
      if (body.parentTaskId !== undefined) updateData.parentTaskId = body.parentTaskId;

      const [updated]: any = await db
        .update(workspaceTasks)
        .set(updateData)
        .where(eq(workspaceTasks.id, id))
        .returning();

      await logWorkspaceActivity({
        actorId: meId,
        actorName: adminMember.name,
        actionType: "task.update",
        targetType: "task",
        targetId: id,
        targetTitle: updated.title,
        metadata: { changedKeys: Object.keys(updateData) },
        visibility: "team",
      });

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.task.update", target: `task:${id}`,
        detail: { changed: Object.keys(updateData) }, req,
      });

      return ok(updated, "작업이 수정되었습니다");
    }

    /* ════════════════════════════════════════════
       DELETE
    ════════════════════════════════════════════ */
    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id 필수");

      const [task]: any = await db
        .select()
        .from(workspaceTasks)
        .where(eq(workspaceTasks.id, id))
        .limit(1);
      if (!task) return notFound("작업을 찾을 수 없습니다");

      // 본인 task(지시받지 않은 것)만 삭제 가능 + super_admin
      const isOwnPersonalTask = task.memberId === meId && !task.assignedBy;
      if (!isOwnPersonalTask && !isSuperAdmin) {
        return forbidden("지시받은 작업은 삭제할 수 없습니다. 지시자에게 요청하세요");
      }

      await db.delete(workspaceTasks).where(eq(workspaceTasks.id, id));

      await logWorkspaceActivity({
        actorId: meId,
        actorName: adminMember.name,
        actionType: "task.delete",
        targetType: "task",
        targetId: id,
        targetTitle: task.title,
        metadata: { priority: task.priority, status: task.status },
        visibility: "team",
      });

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.task.delete", target: `task:${id}`,
        detail: { title: task.title }, req,
      });

      return ok({ id }, "작업이 삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-workspace-tasks] error:", err);
    return serverError("작업 처리 중 오류", err);
  }
};
