/**
 * Phase 3 Step 7-B.2 — 워크스페이스 작업 댓글 CRUD + @멘션
 *
 * GET    ?taskId=N            : 댓글 목록 (deletedAt IS NULL, 작성자 정보 JOIN)
 * GET    ?id=N                : 단건 (대댓글 컨텍스트용)
 * POST   {taskId, content, mentions?, parentCommentId?}
 *                             : 댓글 작성, 멘션된 멤버에게 알림 발송
 * PATCH  ?id=N {content}      : 본인 댓글 수정 (super_admin은 누구나)
 * DELETE ?id=N                : soft delete (본인 + super_admin)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import {
  workspaceTaskComments,
  workspaceTasks,
  members,
} from "../../db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, methodNotAllowed,
  serverError, parseJson,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";
import {
  logWorkspaceActivity,
  sendWorkspaceNotification,
} from "../../lib/workspace-logger";

const MAX_CONTENT_LEN = 5000;
const MAX_MENTIONS = 20;

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const adminMember = guard.ctx.member as any;
  const meId = adminMember.id as number;
  const isSuperAdmin = (adminMember.role || "") === "super_admin";

  const url = new URL(req.url);

  try {
    /* ════════════════════════════════════════════
       GET
    ════════════════════════════════════════════ */
    if (req.method === "GET") {
      const id = url.searchParams.get("id");
      const taskIdRaw = url.searchParams.get("taskId");

      if (id) {
        const rows: any = await db
          .select({
            id: workspaceTaskComments.id,
            taskId: workspaceTaskComments.taskId,
            memberId: workspaceTaskComments.memberId,
            content: workspaceTaskComments.content,
            mentions: workspaceTaskComments.mentions,
            parentCommentId: workspaceTaskComments.parentCommentId,
            createdAt: workspaceTaskComments.createdAt,
            updatedAt: workspaceTaskComments.updatedAt,
            deletedAt: workspaceTaskComments.deletedAt,
            authorName: members.name,
            authorEmail: members.email,
          })
          .from(workspaceTaskComments)
          .leftJoin(members, eq(workspaceTaskComments.memberId, members.id))
          .where(eq(workspaceTaskComments.id, Number(id)))
          .limit(1);
        const row = rows[0];
        if (!row || row.deletedAt) return notFound("댓글을 찾을 수 없습니다");
        return ok(row);
      }

      if (!taskIdRaw) return badRequest("taskId 또는 id 필수");
      const taskId = Number(taskIdRaw);
      if (!taskId) return badRequest("taskId 유효하지 않음");

      const items: any = await db
        .select({
          id: workspaceTaskComments.id,
          taskId: workspaceTaskComments.taskId,
          memberId: workspaceTaskComments.memberId,
          content: workspaceTaskComments.content,
          mentions: workspaceTaskComments.mentions,
          parentCommentId: workspaceTaskComments.parentCommentId,
          createdAt: workspaceTaskComments.createdAt,
          updatedAt: workspaceTaskComments.updatedAt,
          authorName: members.name,
          authorEmail: members.email,
        })
        .from(workspaceTaskComments)
        .leftJoin(members, eq(workspaceTaskComments.memberId, members.id))
        .where(
          and(
            eq(workspaceTaskComments.taskId, taskId),
            isNull(workspaceTaskComments.deletedAt)
          )
        )
        .orderBy(desc(workspaceTaskComments.createdAt));

      return ok({ items, total: items.length });
    }

    /* ════════════════════════════════════════════
       POST — 작성
    ════════════════════════════════════════════ */
    if (req.method === "POST") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("body 필수");

      const taskId = Number(body.taskId);
      if (!taskId) return badRequest("taskId 필수");

      const content = String(body.content || "").trim();
      if (!content) return badRequest("content 필수");
      if (content.length > MAX_CONTENT_LEN) return badRequest(`content 최대 ${MAX_CONTENT_LEN}자`);

      const mentions: number[] = Array.isArray(body.mentions)
        ? body.mentions.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n) && n > 0).slice(0, MAX_MENTIONS)
        : [];

      const parentCommentId = body.parentCommentId ? Number(body.parentCommentId) : null;

      // 작업 존재 + 접근 권한 확인 (소유자/지시자/지시받은자 또는 super_admin)
      const [task]: any = await db.select().from(workspaceTasks).where(eq(workspaceTasks.id, taskId)).limit(1);
      if (!task) return notFound("작업을 찾을 수 없습니다");
      const canAccess =
        isSuperAdmin || task.memberId === meId || task.assignedTo === meId || task.assignedBy === meId;
      if (!canAccess) return forbidden("이 작업에 댓글을 작성할 권한이 없습니다");

      // 부모 댓글 검증
      if (parentCommentId) {
        const [parent]: any = await db
          .select()
          .from(workspaceTaskComments)
          .where(eq(workspaceTaskComments.id, parentCommentId))
          .limit(1);
        if (!parent || parent.deletedAt) return badRequest("부모 댓글을 찾을 수 없습니다");
        if (parent.taskId !== taskId) return badRequest("부모 댓글이 다른 작업에 속함");
      }

      const inserted: any = await db
        .insert(workspaceTaskComments)
        .values({
          taskId,
          memberId: meId,
          content,
          mentions: mentions as any,
          parentCommentId,
        } as any)
        .returning();
      const newComment = inserted[0];

      // 활동 로그
      await logWorkspaceActivity({
        actorId: meId,
        actorName: adminMember.name,
        actionType: "task.update" as any,
        targetType: "task",
        targetId: taskId,
        targetTitle: task.title,
        metadata: {
          subType: "comment.create",
          commentId: newComment.id,
          parentCommentId,
          mentionsCount: mentions.length,
        },
        visibility: "team",
      });

      // 멘션 알림 (본인 제외)
      const notifyTargets = new Set<number>(mentions.filter((id: number) => id !== meId));
      // 작업 소유자/지시자에게도 (멘션 대상이 아니면) 알림
      if (task.memberId && task.memberId !== meId) notifyTargets.add(task.memberId);
      if (task.assignedBy && task.assignedBy !== meId) notifyTargets.add(task.assignedBy);
      if (parentCommentId) {
        // 부모 댓글 작성자에게도 알림
        const [parent]: any = await db
          .select({ memberId: workspaceTaskComments.memberId })
          .from(workspaceTaskComments)
          .where(eq(workspaceTaskComments.id, parentCommentId))
          .limit(1);
        if (parent && parent.memberId !== meId) notifyTargets.add(parent.memberId);
      }

      const isMentioned = (id: number) => mentions.includes(id);
      for (const targetId of notifyTargets) {
        try {
          await sendWorkspaceNotification({
            memberId: targetId,
            sourceType: "task",
            sourceId: taskId,
            notifType: "status_changed",
            channel: "bell",
            title: isMentioned(targetId)
              ? `💬 ${adminMember.name}님이 멘션: ${task.title}`
              : `💬 ${adminMember.name}님 댓글: ${task.title}`,
            body: content.slice(0, 200),
            actionUrl: `/workspace-kanban.html#task=${taskId}`,
          });
        } catch (err) {
          console.warn("[task-comments] 알림 발송 실패:", err);
        }
      }

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.task.comment.create",
        target: `comment:${newComment.id}`,
        detail: { taskId, mentionsCount: mentions.length },
        req,
      });

      return ok(newComment, "댓글이 작성되었습니다");
    }

    /* ════════════════════════════════════════════
       PATCH — 수정 (본인 + super_admin)
    ════════════════════════════════════════════ */
    if (req.method === "PATCH") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id 필수");
      const body: any = await parseJson(req);
      if (!body) return badRequest("body 필수");

      const [comment]: any = await db
        .select()
        .from(workspaceTaskComments)
        .where(eq(workspaceTaskComments.id, id))
        .limit(1);
      if (!comment || comment.deletedAt) return notFound("댓글을 찾을 수 없습니다");

      if (!isSuperAdmin && comment.memberId !== meId) {
        return forbidden("본인 댓글만 수정할 수 있습니다");
      }

      const content = String(body.content || "").trim();
      if (!content) return badRequest("content 필수");
      if (content.length > MAX_CONTENT_LEN) return badRequest(`content 최대 ${MAX_CONTENT_LEN}자`);

      const updateData: any = { content, updatedAt: new Date() };
      if (Array.isArray(body.mentions)) {
        updateData.mentions = body.mentions
          .map((x: any) => Number(x))
          .filter((n: number) => Number.isFinite(n) && n > 0)
          .slice(0, MAX_MENTIONS);
      }

      const [updated]: any = await db
        .update(workspaceTaskComments)
        .set(updateData)
        .where(eq(workspaceTaskComments.id, id))
        .returning();

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.task.comment.update",
        target: `comment:${id}`,
        detail: { taskId: comment.taskId },
        req,
      });

      return ok(updated, "댓글이 수정되었습니다");
    }

    /* ════════════════════════════════════════════
       DELETE — soft delete (본인 + super_admin)
    ════════════════════════════════════════════ */
    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id 필수");

      const [comment]: any = await db
        .select()
        .from(workspaceTaskComments)
        .where(eq(workspaceTaskComments.id, id))
        .limit(1);
      if (!comment || comment.deletedAt) return notFound("댓글을 찾을 수 없습니다");

      if (!isSuperAdmin && comment.memberId !== meId) {
        return forbidden("본인 댓글만 삭제할 수 있습니다");
      }

      await db
        .update(workspaceTaskComments)
        .set({ deletedAt: new Date(), updatedAt: new Date() } as any)
        .where(eq(workspaceTaskComments.id, id));

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.task.comment.delete",
        target: `comment:${id}`,
        detail: { taskId: comment.taskId },
        req,
      });

      return ok({ id }, "댓글이 삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-workspace-task-comments] error:", err);
    return serverError("댓글 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin-workspace-task-comments" };
