// netlify/functions/admin-service-assignee.ts
// ★ 2026-05-12 워크스페이스 v2 — 서비스 상세에서 담당자 변경 (역방향 동기화)
//
// POST /api/admin/service-assignee
//   body: {
//     serviceType: 'incident_report' | 'harassment_report' | 'legal_consultation' | 'support_request',
//     sourceId: number,
//     newAssigneeId: number,
//     message?: string
//   }
//
// 동작
//   1. 서비스 테이블의 assigned_to (또는 assigned_member_id) 갱신
//   2. 연결된 workspace_task의 assigned_to 갱신
//   3. workspace_task_transfers에 이력 1줄 기록
//   4. 새 담당자에게 알림 발송
//
// 권한
//   - 현재 담당자, 카드 생성자, super_admin이거나, 본인을 새 담당자로 지정(자기 수락)인 경우

import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { syncAssigneeFromService } from "../../lib/workspace-sync";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin/service-assignee" };

/* 서비스 종류별 테이블/컬럼 매핑 (workspace-sync와 동일) */
const SERVICE_TABLE_INFO: Record<string, {
  table: string;
  assignedCol: string;
  taskRefCol: string;
  label: string;
}> = {
  incident_report:    { table: "incident_reports",    assignedCol: "assigned_to",        taskRefCol: "workspace_task_id", label: "🚨 SIREN-사건" },
  harassment_report:  { table: "harassment_reports",  assignedCol: "assigned_to",        taskRefCol: "workspace_task_id", label: "⚠️ SIREN-악성민원" },
  legal_consultation: { table: "legal_consultations", assignedCol: "assigned_to",        taskRefCol: "workspace_task_id", label: "⚖️ SIREN-법률" },
  support_request:    { table: "support_requests",    assignedCol: "assigned_member_id", taskRefCol: "workspace_task_id", label: "🎗 유족지원" },
};

function pickRows(r: any): any[] {
  return Array.isArray(r) ? r : (r?.rows || []);
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const meId = guard.ctx.admin.uid;
  const meName = guard.ctx.admin.name || "운영자";
  const adminMember = guard.ctx.member;
  const isSuper = String(adminMember?.role || "") === "super_admin";

  try {
    /* ===== GET — 현재 담당자 + 운영자 후보 ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const serviceType = String(url.searchParams.get("serviceType") || "");
      const sourceId = Number(url.searchParams.get("sourceId"));
      if (!serviceType || !Number.isFinite(sourceId)) return badRequest("serviceType + sourceId 필요");

      const info = SERVICE_TABLE_INFO[serviceType];
      if (!info) return badRequest("지원하지 않는 serviceType");

      const r: any = await db.execute(sql`
        SELECT
          ${sql.identifier(info.assignedCol)} AS "assigneeId",
          ${sql.identifier(info.taskRefCol)} AS "workspaceTaskId"
        FROM ${sql.identifier(info.table)}
        WHERE id = ${sourceId}
        LIMIT 1
      `);
      const row = pickRows(r)[0];
      if (!row) return notFound("서비스 레코드를 찾을 수 없습니다");

      let assignee: any = null;
      if (row.assigneeId) {
        const [m]: any = await db.select({ id: members.id, name: members.name, email: members.email, role: members.role, operatorActive: members.operatorActive })
          .from(members).where(eq(members.id, row.assigneeId)).limit(1);
        if (m) assignee = m;
      }

      /* 운영자 후보 명단 */
      const opsRaw: any = await db.execute(sql`
        SELECT id, name, email, role, operator_active AS "operatorActive"
        FROM members
        WHERE role IS NOT NULL
        ORDER BY operator_active DESC, name ASC
      `);
      const operators = pickRows(opsRaw);

      return ok({
        serviceType,
        sourceId,
        serviceLabel: info.label,
        assignee,
        workspaceTaskId: row.workspaceTaskId,
        operators,
        canEdit: true, /* 모든 운영자가 변경 가능 — 필요 시 권한 강화 */
      });
    }

    /* ===== POST — 담당자 변경 ===== */
    if (req.method === "POST") {
      const body: any = await parseJson(req);
      const serviceType = String(body?.serviceType || "");
      const sourceId = Number(body?.sourceId);
      const newAssigneeId = Number(body?.newAssigneeId);
      const message = (body?.message || "").toString().trim() || null;

      if (!serviceType || !Number.isFinite(sourceId) || !Number.isFinite(newAssigneeId)) {
        return badRequest("serviceType + sourceId + newAssigneeId 필요");
      }
      const info = SERVICE_TABLE_INFO[serviceType];
      if (!info) return badRequest("지원하지 않는 serviceType");

      /* 대상 운영자 검증 */
      const [target]: any = await db.select({ id: members.id, role: members.role, operatorActive: members.operatorActive, name: members.name })
        .from(members).where(eq(members.id, newAssigneeId)).limit(1);
      if (!target) return badRequest("대상 운영자를 찾을 수 없습니다");
      if (!target.role) return badRequest(`${target.name}님은 운영자가 아닙니다`);

      /* 현재 담당자 확인 (권한 체크) */
      const r: any = await db.execute(sql`
        SELECT ${sql.identifier(info.assignedCol)} AS "currentAssignee"
        FROM ${sql.identifier(info.table)}
        WHERE id = ${sourceId}
        LIMIT 1
      `);
      const row = pickRows(r)[0];
      if (!row) return notFound("서비스 레코드를 찾을 수 없습니다");
      const currentAssignee = row.currentAssignee ? Number(row.currentAssignee) : null;

      /* 권한: super_admin / 현재 담당자 / 자기 자신을 새 담당자로 지정 */
      const canChange = isSuper || currentAssignee === meId || newAssigneeId === meId;
      if (!canChange) {
        return forbidden("담당자 변경 권한이 없습니다 (현재 담당자 / 본인 수락 / super_admin만)");
      }

      /* 동일 담당자 차단 */
      if (currentAssignee === newAssigneeId) {
        return badRequest("이미 해당 운영자가 담당자입니다");
      }

      /* 양방향 동기화 (서비스 + 워크스페이스 카드 + 이력) */
      const result = await syncAssigneeFromService({
        serviceType: serviceType as any,
        sourceId,
        newAssigneeId,
        changedBy: meId,
        message: message || `${meName}님이 ${info.label} 상세에서 담당자를 변경했습니다`,
      });
      if (!result.ok) return serverError("담당자 변경 실패", result.error);

      /* 새 담당자에게 알림 */
      try {
        await sendWorkspaceNotification({
          memberId: newAssigneeId,
          sourceType: "task",
          sourceId: result.taskId || 0,
          notifType: "assigned",
          channel: "bell",
          title: `🎯 ${info.label} #${sourceId} — 담당자로 지정됨`,
          body: message || `${meName}님이 회원님을 담당자로 지정했습니다`,
          actionUrl: result.taskId ? `/workspace-kanban.html?taskId=${result.taskId}` : null,
        });
      } catch (_) {}

      try {
        await logAdminAction(req, meId, meName, "service_assignee_change", {
          target: `${serviceType}#${sourceId}`,
          detail: { from: currentAssignee, to: newAssigneeId, taskId: result.taskId },
        });
      } catch (_) {}

      return ok({
        serviceType,
        sourceId,
        newAssigneeId,
        newAssigneeName: target.name,
        workspaceTaskId: result.taskId,
      }, `${target.name}님에게 담당자가 변경되었습니다`);
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-service-assignee]", e);
    return serverError("처리 실패", e?.message);
  }
};
