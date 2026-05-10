/**
 * Phase 3 Step 7-B.2 — 워크스페이스 작업 보고서 (중간/완료) + 검토 워크플로우
 *
 * GET    ?taskId=N                  : 작업의 보고서 목록
 * GET    ?id=N                      : 단건 (검토 정보 포함)
 * POST   {taskId, type, title?, content, attachedFileIds?}
 *                                   : 보고서 작성 (type: progress | completion)
 *                                   : completion 작성 시 작업 소유자/지시자에게 알림
 * PATCH  ?id=N {title?, content?, attachedFileIds?}
 *                                   : 본인 보고서 수정 (검토 전 + super_admin)
 * PATCH  ?id=N&action=review {reviewStatus, reviewReason?}
 *                                   : 검토 (승인/반려) — 작업 소유자/지시자/super_admin
 * DELETE ?id=N                      : 본인 + super_admin (검토 전)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import {
  workspaceTaskReports,
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
import {
  logWorkspaceActivity,
  sendWorkspaceNotification,
} from "../../lib/workspace-logger";

const MAX_TITLE_LEN = 300;
const MAX_CONTENT_LEN = 10000;
const ALLOWED_TYPE = new Set(["progress", "completion"]);
const ALLOWED_REVIEW = new Set(["pending", "approved", "rejected"]);

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
      const id = url.searchParams.get("id");
      const taskIdRaw = url.searchParams.get("taskId");

      if (id) {
        const rows: any = await db
          .select({
            id: workspaceTaskReports.id,
            taskId: workspaceTaskReports.taskId,
            memberId: workspaceTaskReports.memberId,
            type: workspaceTaskReports.type,
            title: workspaceTaskReports.title,
            content: workspaceTaskReports.content,
            attachedFileIds: workspaceTaskReports.attachedFileIds,
            reviewStatus: workspaceTaskReports.reviewStatus,
            reviewedBy: workspaceTaskReports.reviewedBy,
            reviewedAt: workspaceTaskReports.reviewedAt,
            reviewReason: workspaceTaskReports.reviewReason,
            createdAt: workspaceTaskReports.createdAt,
            updatedAt: workspaceTaskReports.updatedAt,
            authorName: members.name,
            authorEmail: members.email,
          })
          .from(workspaceTaskReports)
          .leftJoin(members, eq(workspaceTaskReports.memberId, members.id))
          .where(eq(workspaceTaskReports.id, Number(id)))
          .limit(1);
        if (!rows[0]) return notFound("보고서를 찾을 수 없습니다");
        return ok(rows[0]);
      }

      if (!taskIdRaw) return badRequest("taskId 또는 id 필수");
      const taskId = Number(taskIdRaw);
      if (!taskId) return badRequest("taskId 유효하지 않음");

      const items: any = await db
        .select({
          id: workspaceTaskReports.id,
          taskId: workspaceTaskReports.taskId,
          memberId: workspaceTaskReports.memberId,
          type: workspaceTaskReports.type,
          title: workspaceTaskReports.title,
          content: workspaceTaskReports.content,
          attachedFileIds: workspaceTaskReports.attachedFileIds,
          reviewStatus: workspaceTaskReports.reviewStatus,
          reviewedBy: workspaceTaskReports.reviewedBy,
          reviewedAt: workspaceTaskReports.reviewedAt,
          reviewReason: workspaceTaskReports.reviewReason,
          createdAt: workspaceTaskReports.createdAt,
          updatedAt: workspaceTaskReports.updatedAt,
          authorName: members.name,
          authorEmail: members.email,
        })
        .from(workspaceTaskReports)
        .leftJoin(members, eq(workspaceTaskReports.memberId, members.id))
        .where(eq(workspaceTaskReports.taskId, taskId))
        .orderBy(desc(workspaceTaskReports.createdAt));

      return ok({ items, total: items.length });
    }

    /* ════════ POST — 작성 ════════ */
    if (req.method === "POST") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("body 필수");

      const taskId = Number(body.taskId);
      if (!taskId) return badRequest("taskId 필수");
      const type = String(body.type || "");
      if (!ALLOWED_TYPE.has(type)) return badRequest("type은 progress 또는 completion");

      const content = String(body.content || "").trim();
      if (!content) return badRequest("content 필수");
      if (content.length > MAX_CONTENT_LEN) return badRequest(`content 최대 ${MAX_CONTENT_LEN}자`);

      const title = body.title ? String(body.title).slice(0, MAX_TITLE_LEN) : null;
      const attachedFileIds: number[] = Array.isArray(body.attachedFileIds)
        ? body.attachedFileIds.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n) && n > 0).slice(0, 50)
        : [];

      const [task]: any = await db.select().from(workspaceTasks).where(eq(workspaceTasks.id, taskId)).limit(1);
      if (!task) return notFound("작업을 찾을 수 없습니다");
      const canReport =
        isSuperAdmin || task.memberId === meId || task.assignedTo === meId;
      if (!canReport) return forbidden("이 작업에 보고할 권한이 없습니다");

      const inserted: any = await db
        .insert(workspaceTaskReports)
        .values({
          taskId,
          memberId: meId,
          type,
          title,
          content,
          attachedFileIds: attachedFileIds as any,
          reviewStatus: "pending",
        } as any)
        .returning();
      const newReport = inserted[0];

      await logWorkspaceActivity({
        actorId: meId,
        actorName: adminMember.name,
        actionType: "task.update" as any,
        targetType: "task",
        targetId: taskId,
        targetTitle: task.title,
        metadata: {
          subType: type === "completion" ? "report.completion" : "report.progress",
          reportId: newReport.id,
          attachedFiles: attachedFileIds.length,
        },
        visibility: "team",
      });

      // 검토 대상자에게 알림 (지시자 우선, 없으면 소유자)
      const reviewerCandidates = new Set<number>();
      if (task.assignedBy && task.assignedBy !== meId) reviewerCandidates.add(task.assignedBy);
      if (task.memberId && task.memberId !== meId) reviewerCandidates.add(task.memberId);

      for (const reviewerId of reviewerCandidates) {
        try {
          await sendWorkspaceNotification({
            memberId: reviewerId,
            sourceType: "task",
            sourceId: taskId,
            notifType: type === "completion" ? "completed" : "status_changed",
            channel: "bell",
            title: type === "completion"
              ? `📊 완료 보고: ${task.title}`
              : `📊 중간 보고: ${task.title}`,
            body: (title ? `${title} — ` : "") + content.slice(0, 150),
            actionUrl: `/workspace-kanban.html#task=${taskId}`,
          });
        } catch (err) {
          console.warn("[task-reports] 알림 발송 실패:", err);
        }
      }

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: `workspace.task.report.${type}`,
        target: `report:${newReport.id}`,
        detail: { taskId, attachedFiles: attachedFileIds.length },
        req,
      });

      return ok(newReport, "보고서가 등록되었습니다");
    }

    /* ════════ PATCH ════════ */
    if (req.method === "PATCH") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id 필수");
      const action = url.searchParams.get("action");
      const body: any = await parseJson(req);
      if (!body) return badRequest("body 필수");

      const [report]: any = await db
        .select()
        .from(workspaceTaskReports)
        .where(eq(workspaceTaskReports.id, id))
        .limit(1);
      if (!report) return notFound("보고서를 찾을 수 없습니다");

      const [task]: any = await db.select().from(workspaceTasks).where(eq(workspaceTasks.id, report.taskId)).limit(1);

      // 검토 액션
      if (action === "review") {
        const reviewStatus = String(body.reviewStatus || "");
        if (!["approved", "rejected"].includes(reviewStatus)) {
          return badRequest("reviewStatus는 approved 또는 rejected");
        }
        const canReview =
          isSuperAdmin ||
          (task && (task.memberId === meId || task.assignedBy === meId));
        if (!canReview) return forbidden("검토 권한이 없습니다");

        const reviewReason = body.reviewReason ? String(body.reviewReason).slice(0, 1000) : null;

        const [updated]: any = await db
          .update(workspaceTaskReports)
          .set({
            reviewStatus,
            reviewedBy: meId,
            reviewedAt: new Date(),
            reviewReason,
            updatedAt: new Date(),
          } as any)
          .where(eq(workspaceTaskReports.id, id))
          .returning();

        // 작성자에게 알림
        if (report.memberId !== meId) {
          try {
            await sendWorkspaceNotification({
              memberId: report.memberId,
              sourceType: "task",
              sourceId: report.taskId,
              notifType: reviewStatus === "approved" ? "approved" : "rejected",
              channel: "bell",
              title: reviewStatus === "approved"
                ? `✅ 보고서 승인: ${task?.title || "작업"}`
                : `❌ 보고서 반려: ${task?.title || "작업"}`,
              body: reviewReason || "",
              actionUrl: `/workspace-kanban.html#task=${report.taskId}`,
            });
          } catch (err) {
            console.warn("[task-reports] 검토 알림 실패:", err);
          }
        }

        await logAudit({
          userId: meId, userType: "admin", userName: adminMember.name,
          action: `workspace.task.report.${reviewStatus}`,
          target: `report:${id}`,
          detail: { taskId: report.taskId, reviewReason },
          req,
        });

        return ok(updated, reviewStatus === "approved" ? "승인되었습니다" : "반려되었습니다");
      }

      // 일반 수정 (본인 + 검토 전)
      if (!isSuperAdmin && report.memberId !== meId) {
        return forbidden("본인 보고서만 수정할 수 있습니다");
      }
      if (report.reviewStatus !== "pending") {
        return badRequest("이미 검토된 보고서는 수정할 수 없습니다");
      }

      const updateData: any = { updatedAt: new Date() };
      if (body.title !== undefined) {
        updateData.title = body.title ? String(body.title).slice(0, MAX_TITLE_LEN) : null;
      }
      if (body.content !== undefined) {
        const c = String(body.content).trim();
        if (!c) return badRequest("content 비어있음");
        if (c.length > MAX_CONTENT_LEN) return badRequest(`content 최대 ${MAX_CONTENT_LEN}자`);
        updateData.content = c;
      }
      if (Array.isArray(body.attachedFileIds)) {
        updateData.attachedFileIds = body.attachedFileIds
          .map((x: any) => Number(x))
          .filter((n: number) => Number.isFinite(n) && n > 0)
          .slice(0, 50);
      }

      const [updated]: any = await db
        .update(workspaceTaskReports)
        .set(updateData)
        .where(eq(workspaceTaskReports.id, id))
        .returning();

      return ok(updated, "수정되었습니다");
    }

    /* ════════ DELETE ════════ */
    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return badRequest("id 필수");

      const [report]: any = await db
        .select()
        .from(workspaceTaskReports)
        .where(eq(workspaceTaskReports.id, id))
        .limit(1);
      if (!report) return notFound("보고서를 찾을 수 없습니다");

      if (!isSuperAdmin && report.memberId !== meId) {
        return forbidden("본인 보고서만 삭제할 수 있습니다");
      }
      if (report.reviewStatus !== "pending" && !isSuperAdmin) {
        return badRequest("이미 검토된 보고서는 삭제할 수 없습니다");
      }

      await db.delete(workspaceTaskReports).where(eq(workspaceTaskReports.id, id));

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "workspace.task.report.delete",
        target: `report:${id}`,
        detail: { taskId: report.taskId },
        req,
      });

      return ok({ id }, "보고서가 삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-workspace-task-reports] error:", err);
    return serverError("보고서 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin-workspace-task-reports" };
