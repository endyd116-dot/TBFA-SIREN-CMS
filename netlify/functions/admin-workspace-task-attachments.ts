/**
 * Phase 3 Step 7-B.2 — 카드 ↔ 파일함 연결 (workspace_task_attachments)
 *
 * GET    ?taskId=N            : 작업에 연결된 파일 목록 (workspaceFiles JOIN)
 * POST   {taskId, fileId}     : 첨부 추가 (UNIQUE: taskId + fileId)
 * DELETE ?id=N                : 첨부 제거 (연결만 끊고 파일 자체는 유지)
 *
 * 권한:
 *   - 작업 접근 가능자(소유자/지시자/지시받은자/super_admin)는 첨부 추가/제거
 *   - 파일 자체에 대한 권한은 파일함 API가 별도 검증 (이 API는 연결만 관리)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import {
  workspaceTaskAttachments,
  workspaceFiles,
  workspaceTasks,
  members,
} from "../../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, methodNotAllowed,
  serverError, parseJson,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";
import { logWorkspaceActivity } from "../../lib/workspace-logger";

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const adminMember = guard.ctx.member as any;
  const meId = adminMember.id as number;
  const isSuperAdmin = (adminMember.role || "") === "super_admin";

  const url = new URL(req.url);

  try {
    /* ════════ GET ════════ */
    if (req.method === "GET") {
      const taskIdRaw = url.searchParams.get("taskId");
      if (!taskIdRaw) return badRequest("taskId 필수");
      const taskId = Number(taskIdRaw);
      if (!taskId) return badRequest("taskId 유효하지 않음");

      const items: any = await db
        .select({
          id: workspaceTaskAttachments.id,
          taskId: workspaceTaskAttachments.taskId,
          fileId: workspaceTaskAttachments.fileId,
          attachedBy: workspaceTaskAttachments.attachedBy,
          attachedAt: workspaceTaskAttachments.attachedAt,
          fileName: workspaceFiles.name,
          fileSize: workspaceFiles.sizeBytes,
          fileMimeType: workspaceFiles.mimeType,
          fileExt: workspaceFiles.ext,
          fileOwnerId: workspaceFiles.ownerId,
          fileDeletedAt: workspaceFiles.deletedAt,
          attachedByName: members.name,
        })
        .from(workspaceTaskAttachments)
        .leftJoin(workspaceFiles, eq(workspaceTaskAttachments.fileId, workspaceFiles.id))
        .leftJoin(members, eq(workspaceTaskAttachments.attachedBy, members.id))
        .where(eq(workspaceTaskAttachments.taskId, taskId))
        .orderBy(desc(workspaceTaskAttachments.attachedAt));

      // 파일 자체가 삭제(soft)된 첨부는 표시하되 deletedAt 정보 노출
      return ok({ items, total: items.length });
    }

    /* ════════ POST — 첨부 추가 ════════ */
    if (req.method === "POST") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("body 필수");

      const taskId = Number(body.taskId);
      const fileId = Number(body.fileId);
      if (!taskId) return badRequest("taskId 필수");
      if (!fileId) return badRequest("fileId 필수");

      const [task]: any = await db.select().from(workspaceTasks).where(eq(workspaceTasks.id, taskId)).limit(1);
      if (!task) return notFound("작업을 찾을 수 없습니다");
      const canEdit =
        isSuperAdmin || task.memberId === meId || task.assignedTo === meId || task.assignedBy === meId;
      if (!canEdit) return forbidden("이 작업에 첨부할 권한이 없습니다");

      const [file]: any = await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, fileId)).limit(1);
      if (!file) return notFound("파일을 찾을 수 없습니다");
      if (file.deletedAt) return badRequest("삭제된 파일입니다");

      // UNIQUE 위반 시 에러 — 사전 체크
      const dup: any = await db
        .select({ id: workspaceTaskAttachments.id })
        .from(workspaceTaskAttachments)
        .where(
          and(
            eq(workspaceTaskAttachments.taskId, taskId),
            eq(workspaceTaskAttachments.fileId, fileId)
          )
        )
        .limit(1);
      if (dup.length > 0) return badRequest("이미 첨부된 파일입니다");

      const inserted: any = await db
        .insert(workspaceTaskAttachments)
        .values({
          taskId,
          fileId,
          attachedBy: meId,
        })
        .returning();
      const newAttach = inserted[0];

      await logWorkspaceActivity({
        actorId: meId,
        actorName: adminMember.name,
        actionType: "task.attachment.add",
        targetType: "task",
        targetId: taskId,
        targetTitle: task.title,
        metadata: { fileId, fileName: file.name, attachId: newAttach.id },
        visibility: "team",
      });

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.task.attachment.add",
        target: `attach:${newAttach.id}`,
        detail: { taskId, fileId },
        req,
      });

      return ok(newAttach, "파일이 연결되었습니다");
    }

    /* ════════ DELETE — 첨부 제거 ════════ */
    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id 필수");

      const [attach]: any = await db
        .select()
        .from(workspaceTaskAttachments)
        .where(eq(workspaceTaskAttachments.id, id))
        .limit(1);
      if (!attach) return notFound("첨부를 찾을 수 없습니다");

      const [task]: any = await db.select().from(workspaceTasks).where(eq(workspaceTasks.id, attach.taskId)).limit(1);
      const canRemove =
        isSuperAdmin ||
        attach.attachedBy === meId ||
        (task && (task.memberId === meId || task.assignedTo === meId || task.assignedBy === meId));
      if (!canRemove) return forbidden("제거 권한이 없습니다");

      await db.delete(workspaceTaskAttachments).where(eq(workspaceTaskAttachments.id, id));

      await logWorkspaceActivity({
        actorId: meId,
        actorName: adminMember.name,
        actionType: "task.attachment.remove",
        targetType: "task",
        targetId: attach.taskId,
        targetTitle: task?.title || "",
        metadata: { fileId: attach.fileId, attachId: id },
        visibility: "team",
      });

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.task.attachment.remove",
        target: `attach:${id}`,
        detail: { taskId: attach.taskId, fileId: attach.fileId },
        req,
      });

      return ok({ id }, "연결이 해제되었습니다 (파일 자체는 보존됨)");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-workspace-task-attachments] error:", err);
    return serverError("첨부 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin-workspace-task-attachments" };
