// netlify/functions/admin-workspace-task-transfer.ts
// ★ 2026-05-12 워크스페이스 v2 — 카드 토스(재할당) + 할당 이력 조회
//
// 라우트
//   POST /api/admin/workspace-task-transfer
//     body: { taskId, toMemberId, message? }
//     - 현재 담당자 또는 super_admin 또는 카드 생성자만 호출 가능
//     - 양방향 동기화 (lib/workspace-sync.ts)
//
//   GET  /api/admin/workspace-task-transfer?taskId=X
//     - 해당 카드의 토스 이력 (시간순)
//     - 각 줄에 from/to 이름 + 메시지 + 토스 종류

import { eq, asc, sql } from "drizzle-orm";
import { db } from "../../db";
import { workspaceTasks, workspaceTaskTransfers, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";
import { transferWorkspaceTask } from "../../lib/workspace-sync";

export const config = { path: "/api/admin/workspace-task-transfer" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const { admin, member: adminMember } = guard.ctx;

  try {
    /* ===== GET — 이력 조회 ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const taskId = Number(url.searchParams.get("taskId"));
      if (!Number.isFinite(taskId)) return badRequest("taskId 필수");

      const rows: any = await db.execute(sql`
        SELECT
          t.id,
          t.task_id          AS "taskId",
          t.from_member_id   AS "fromMemberId",
          t.to_member_id     AS "toMemberId",
          t.message,
          t.transfer_type    AS "transferType",
          t.snapshot_progress AS "snapshotProgress",
          t.snapshot_status   AS "snapshotStatus",
          t.created_at        AS "createdAt",
          fm.name            AS "fromMemberName",
          tm.name            AS "toMemberName"
        FROM workspace_task_transfers t
        LEFT JOIN members fm ON fm.id = t.from_member_id
        LEFT JOIN members tm ON tm.id = t.to_member_id
        WHERE t.task_id = ${taskId}
        ORDER BY t.created_at ASC, t.id ASC
      `);
      const list = Array.isArray(rows) ? rows : (rows?.rows || []);
      return ok({ list, count: list.length });
    }

    /* ===== POST — 토스 실행 ===== */
    if (req.method === "POST") {
      const body: any = await parseJson(req);
      const taskId = Number(body?.taskId);
      const toMemberId = Number(body?.toMemberId);
      const message = (body?.message || "").toString().trim() || null;

      if (!Number.isFinite(taskId)) return badRequest("taskId 필수");
      if (!Number.isFinite(toMemberId)) return badRequest("toMemberId 필수");

      const [task]: any = await db.select().from(workspaceTasks)
        .where(eq(workspaceTasks.id, taskId)).limit(1);
      if (!task) return notFound("카드를 찾을 수 없습니다");

      /* 권한 체크: 현재 담당자 / 카드 생성자(assigned_by) / 카드 소유자(memberId) / super_admin */
      const isSuper = String(adminMember?.role || "") === "super_admin";
      const me = admin.uid;
      const canTransfer =
        isSuper ||
        task.assignedTo === me ||
        task.assignedBy === me ||
        task.memberId === me;
      if (!canTransfer) {
        return forbidden("이 카드를 토스할 권한이 없습니다 (현재 담당자/생성자/소유자/super_admin만 가능)");
      }

      /* 대상 운영자 검증 */
      const [target]: any = await db.select({ id: members.id, role: members.role, operatorActive: members.operatorActive, name: members.name })
        .from(members).where(eq(members.id, toMemberId)).limit(1);
      if (!target) return badRequest("대상 운영자를 찾을 수 없습니다");
      if (!target.role) return badRequest(`${target.name}님은 운영자가 아닙니다`);

      /* 자기 자신에게 토스 차단 */
      if (toMemberId === task.assignedTo) {
        return badRequest("이미 해당 운영자가 담당자입니다");
      }

      const result = await transferWorkspaceTask({
        taskId,
        fromMemberId: task.assignedTo ?? null,
        toMemberId,
        message: message ?? undefined,
        transferType: "manual",
      });
      if (!result.ok) return serverError("토스 실패", result.error);

      try {
        await logAdminAction(req, admin.uid, admin.name, "workspace_task_transfer", {
          target: `task-${taskId}`,
          detail: { fromMemberId: task.assignedTo, toMemberId, message },
        });
      } catch (_) {}

      return ok({ taskId, toMemberId, toMemberName: target.name }, `${target.name}님에게 작업이 토스되었습니다`);
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-workspace-task-transfer]", e);
    return serverError("처리 실패", e?.message);
  }
};
