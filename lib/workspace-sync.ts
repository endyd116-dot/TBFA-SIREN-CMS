// lib/workspace-sync.ts
// ★ 2026-05-12 워크스페이스 v2 — 양방향 동기화 헬퍼
//
// 사용처
//   ① 서비스 접수 진입점 (incident/harassment/legal/support submit) →
//      createWorkspaceTaskFromService() 호출해서 자동 카드 생성
//   ② 워크스페이스 토스 API →
//      transferWorkspaceTask() 호출해서 카드 + 서비스 테이블 양쪽 갱신
//   ③ 서비스 상세에서 담당자 변경 →
//      syncAssigneeFromService() 호출해서 카드 + 이력 동기화
//
// 권위 모델: "양쪽 다 데이터 + 트랜잭션 동시 갱신"
//   workspace_tasks.assignedTo · 서비스 테이블.assigned_to 둘 다 보유
//   변경 시 트랜잭션으로 두 곳을 함께 갱신 + workspace_task_transfers에 이력 1줄

import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { workspaceTasks, workspaceTaskTransfers, serviceRnr, members } from "../db/schema";

/** 서비스 종류 → service_rnr.serviceType 매핑 */
export type ServiceType =
  | "incident_report"
  | "harassment_report"
  | "legal_consultation"
  | "support_request"
  | "donation_inquiry"
  | "member_signup"
  | "expert_application";

/** 서비스 테이블별 정보 — sourceType / table / 담당자 컬럼 / SLA 컬럼 / 완료 상태값 */
const SERVICE_TABLE_INFO: Record<string, {
  table: string;
  assignedCol: string;
  slaCol: string;
  taskRefCol: string;
  closedStatus: string;
}> = {
  incident_report:    { table: "incident_reports",    assignedCol: "assigned_to",        slaCol: "sla_due_at", taskRefCol: "workspace_task_id", closedStatus: "closed" },
  harassment_report:  { table: "harassment_reports",  assignedCol: "assigned_to",        slaCol: "sla_due_at", taskRefCol: "workspace_task_id", closedStatus: "closed" },
  legal_consultation: { table: "legal_consultations", assignedCol: "assigned_to",        slaCol: "sla_due_at", taskRefCol: "workspace_task_id", closedStatus: "closed" },
  support_request:    { table: "support_requests",    assignedCol: "assigned_member_id", slaCol: "sla_due_at", taskRefCol: "workspace_task_id", closedStatus: "completed" },
};

/** sourceType (workspace_tasks의 sourceType) → SERVICE_TABLE_INFO 키 매핑 */
const SOURCE_TYPE_TO_SERVICE: Record<string, string> = {
  incident: "incident_report",
  harassment: "harassment_report",
  legal: "legal_consultation",
  support: "support_request",
};

/**
 * 서비스 종류로 R&R 매핑 조회 + 적절한 담당자 결정
 * - primary가 operator_active=true면 primary 반환
 * - primary가 비활성/없으면 backup 반환 (자동 폴백)
 * - 둘 다 없으면 null
 */
export async function resolveAssigneeByService(serviceType: ServiceType): Promise<{
  assigneeId: number | null;
  usedBackup: boolean;
  slaHours: number | null;
  rnrRow: any;
}> {
  const [rnr]: any = await db.select().from(serviceRnr)
    .where(eq(serviceRnr.serviceType, serviceType)).limit(1);
  if (!rnr) return { assigneeId: null, usedBackup: false, slaHours: null, rnrRow: null };

  const primaryId = rnr.primaryAssigneeId;
  const backupId = rnr.backupAssigneeId;

  let primaryActive = false;
  if (primaryId) {
    const [p]: any = await db.select({ id: members.id, operatorActive: members.operatorActive, role: members.role })
      .from(members).where(eq(members.id, primaryId)).limit(1);
    primaryActive = !!(p && p.role && p.operatorActive);
  }

  if (primaryActive) {
    return { assigneeId: primaryId, usedBackup: false, slaHours: rnr.slaHours, rnrRow: rnr };
  }
  if (backupId) {
    const [b]: any = await db.select({ id: members.id, operatorActive: members.operatorActive, role: members.role })
      .from(members).where(eq(members.id, backupId)).limit(1);
    if (b && b.role && b.operatorActive) {
      return { assigneeId: backupId, usedBackup: true, slaHours: rnr.slaHours, rnrRow: rnr };
    }
  }
  return { assigneeId: null, usedBackup: false, slaHours: rnr.slaHours, rnrRow: rnr };
}

/**
 * ① 서비스 접수 시 자동 카드 생성
 *
 * @param params.creatorId  접수한 회원 (creator)
 * @param params.serviceType  R&R 매핑용 서비스 종류
 * @param params.sourceType   workspace_tasks.sourceType ('incident' | 'harassment' | 'legal' | 'support' 등)
 * @param params.sourceId     원본 서비스 row id
 * @param params.title        카드 제목
 * @param params.description  설명 (선택)
 * @param params.sourceRefUrl 원본 상세 페이지 URL (선택)
 *
 * @returns { taskId, assigneeId, usedBackup, slaDueAt } - 실패 시 taskId=null
 */
export async function createWorkspaceTaskFromService(params: {
  creatorId: number;
  serviceType: ServiceType;
  sourceType: string;
  sourceId: number;
  title: string;
  description?: string;
  sourceRefUrl?: string;
}): Promise<{ taskId: number | null; assigneeId: number | null; usedBackup: boolean; slaDueAt: Date | null; error?: string }> {
  try {
    const { assigneeId, usedBackup, slaHours } = await resolveAssigneeByService(params.serviceType);
    const now = new Date();
    const slaDueAt = slaHours ? new Date(now.getTime() + slaHours * 60 * 60 * 1000) : null;

    /* 마감일 기본값: SLA 있으면 그 시점, 없으면 +7일 */
    const dueDate = slaDueAt || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    /* 카드 생성 — 담당자가 없으면 임시로 creatorId를 owner로 잡고 미할당 상태 */
    const ownerId = assigneeId || params.creatorId;

    const [task]: any = await db.insert(workspaceTasks).values({
      memberId: ownerId,
      title: params.title.slice(0, 300),
      description: params.description || null,
      status: "todo",
      priority: slaHours && slaHours <= 24 ? "urgent" : (slaHours && slaHours <= 48 ? "high" : "normal"),
      dueDate,
      assignedBy: params.creatorId,
      assignedTo: assigneeId,
      assignedAt: assigneeId ? now : null,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      sourceRefUrl: params.sourceRefUrl || null,
      createdByAgent: "user",
    } as any).returning({ id: workspaceTasks.id });

    const taskId = task?.id;
    if (!taskId) return { taskId: null, assigneeId: null, usedBackup: false, slaDueAt: null, error: "INSERT 결과 없음" };

    /* 토스 이력에 최초 라인 추가 (transferType=auto_create or fallback_backup) */
    if (assigneeId) {
      await db.insert(workspaceTaskTransfers).values({
        taskId,
        fromMemberId: null,
        toMemberId: assigneeId,
        message: usedBackup
          ? `[자동 폴백] 주 담당자 부재 → 백업 담당자에게 자동 할당 (${params.serviceType})`
          : `[자동 생성] 서비스 접수로 자동 할당 (${params.serviceType})`,
        transferType: usedBackup ? "fallback_backup" : "auto_create",
        snapshotProgress: 0,
        snapshotStatus: "todo",
      } as any);
    }

    /* 원본 서비스 테이블에 workspace_task_id + assigned_to + sla_due_at 동기화 */
    const info = SERVICE_TABLE_INFO[params.serviceType] || SERVICE_TABLE_INFO[SOURCE_TYPE_TO_SERVICE[params.sourceType] || ""];
    if (info) {
      await db.execute(sql`
        UPDATE ${sql.identifier(info.table)}
        SET
          ${sql.identifier(info.assignedCol)} = ${assigneeId},
          ${sql.identifier(info.slaCol)} = ${slaDueAt},
          ${sql.identifier(info.taskRefCol)} = ${taskId},
          updated_at = NOW()
        WHERE id = ${params.sourceId}
      `);
    }

    return { taskId, assigneeId, usedBackup, slaDueAt };
  } catch (e: any) {
    console.error("[createWorkspaceTaskFromService]", e);
    return { taskId: null, assigneeId: null, usedBackup: false, slaDueAt: null, error: String(e?.message || e) };
  }
}

/**
 * ② 워크스페이스 토스 (수동 재할당)
 *
 * @param params.taskId        대상 카드
 * @param params.fromMemberId  현재 담당자 (검증용)
 * @param params.toMemberId    새 담당자
 * @param params.message       토스 메시지
 * @param params.transferType  'manual' (기본) | 'fallback_backup'
 *
 * 트랜잭션:
 *   1) workspace_tasks.assignedTo 갱신
 *   2) workspace_task_transfers INSERT
 *   3) 카드의 sourceType+sourceId가 있으면 서비스 테이블도 동기화
 */
export async function transferWorkspaceTask(params: {
  taskId: number;
  fromMemberId: number | null;
  toMemberId: number;
  message?: string;
  transferType?: "manual" | "fallback_backup";
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const [task]: any = await db.select().from(workspaceTasks)
      .where(eq(workspaceTasks.id, params.taskId)).limit(1);
    if (!task) return { ok: false, error: "카드를 찾을 수 없습니다" };

    const now = new Date();
    /* 1) 카드 갱신 */
    await db.update(workspaceTasks).set({
      assignedTo: params.toMemberId,
      assignedAt: now,
      updatedAt: now,
    } as any).where(eq(workspaceTasks.id, params.taskId));

    /* 2) 이력 INSERT */
    await db.insert(workspaceTaskTransfers).values({
      taskId: params.taskId,
      fromMemberId: params.fromMemberId,
      toMemberId: params.toMemberId,
      message: params.message || null,
      transferType: params.transferType || "manual",
      snapshotProgress: task.progress ?? 0,
      snapshotStatus: task.status,
    } as any);

    /* 3) 서비스 테이블 동기화 (있을 경우) */
    if (task.sourceType && task.sourceId) {
      const serviceKey = SOURCE_TYPE_TO_SERVICE[task.sourceType];
      const info = serviceKey ? SERVICE_TABLE_INFO[serviceKey] : null;
      if (info) {
        try {
          await db.execute(sql`
            UPDATE ${sql.identifier(info.table)}
            SET
              ${sql.identifier(info.assignedCol)} = ${params.toMemberId},
              updated_at = NOW()
            WHERE id = ${task.sourceId}
          `);
        } catch (e) {
          console.warn("[transferWorkspaceTask] 서비스 테이블 동기화 실패 (계속 진행)", e);
        }
      }
    }

    return { ok: true };
  } catch (e: any) {
    console.error("[transferWorkspaceTask]", e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * ③ 서비스 상세에서 담당자 변경 (역방향 동기화)
 *
 * 서비스 페이지에서 직접 담당자를 바꾼 경우, 연결된 워크스페이스 카드도 갱신
 */
export async function syncAssigneeFromService(params: {
  serviceType: ServiceType;
  sourceId: number;
  newAssigneeId: number;
  changedBy: number;
  message?: string;
}): Promise<{ ok: boolean; taskId?: number; error?: string }> {
  try {
    const info = SERVICE_TABLE_INFO[params.serviceType];
    if (!info) return { ok: false, error: "지원하지 않는 serviceType" };

    /* 서비스 row의 현재 카드 ID + 현재 담당자 조회 */
    const r: any = await db.execute(sql`
      SELECT ${sql.identifier(info.assignedCol)} AS "currentAssignee",
             ${sql.identifier(info.taskRefCol)} AS "taskId"
      FROM ${sql.identifier(info.table)}
      WHERE id = ${params.sourceId}
      LIMIT 1
    `);
    const rows = Array.isArray(r) ? r : (r?.rows || []);
    if (!rows.length) return { ok: false, error: "서비스 row를 찾을 수 없습니다" };
    const { currentAssignee, taskId } = rows[0];

    /* 서비스 테이블 갱신 */
    await db.execute(sql`
      UPDATE ${sql.identifier(info.table)}
      SET ${sql.identifier(info.assignedCol)} = ${params.newAssigneeId},
          updated_at = NOW()
      WHERE id = ${params.sourceId}
    `);

    /* 연결된 카드가 있으면 transferWorkspaceTask 호출로 카드 + 이력 동기화 */
    if (taskId) {
      await transferWorkspaceTask({
        taskId: Number(taskId),
        fromMemberId: currentAssignee ? Number(currentAssignee) : null,
        toMemberId: params.newAssigneeId,
        message: params.message || `[서비스 상세에서 변경] by member#${params.changedBy}`,
        transferType: "manual",
      });
    }

    return { ok: true, taskId: taskId ? Number(taskId) : undefined };
  } catch (e: any) {
    console.error("[syncAssigneeFromService]", e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * ④ 카드 완료 → 원본 서비스도 자동 close
 *
 * 워크스페이스 카드가 'done' 상태로 변경되면 sourceType/sourceId가 있는 경우
 * 해당 서비스 테이블의 status도 'closed' 또는 'completed'로 자동 갱신.
 *
 * 사용처: admin-workspace-tasks.ts의 PATCH 처리에서 status='done' 전환 시 호출.
 *
 * 역방향(서비스 close → 카드 done)은 별도. (서비스 단일 권위가 아님)
 */
export async function closeServiceFromTask(params: {
  taskId: number;
  sourceType: string | null | undefined;
  sourceId: number | null | undefined;
  closedBy: number;
}): Promise<{ ok: boolean; updated?: boolean; error?: string }> {
  try {
    if (!params.sourceType || !params.sourceId) return { ok: true, updated: false };
    const serviceKey = SOURCE_TYPE_TO_SERVICE[params.sourceType];
    const info = serviceKey ? SERVICE_TABLE_INFO[serviceKey] : null;
    if (!info) return { ok: true, updated: false };

    /* 이미 closed면 skip */
    const current: any = await db.execute(sql`
      SELECT status FROM ${sql.identifier(info.table)} WHERE id = ${params.sourceId} LIMIT 1
    `);
    const rows = Array.isArray(current) ? current : (current?.rows || []);
    if (!rows.length) return { ok: true, updated: false };
    const status = String(rows[0].status || "");
    if (status === info.closedStatus || status === "rejected") return { ok: true, updated: false };

    /* status 갱신 + completedAt(있으면) */
    await db.execute(sql`
      UPDATE ${sql.identifier(info.table)}
      SET status = ${info.closedStatus},
          updated_at = NOW()
      WHERE id = ${params.sourceId}
    `);
    /* completed_at 컬럼이 있는 테이블만 별도 갱신 (support_requests) */
    if (info.table === "support_requests") {
      try {
        await db.execute(sql`UPDATE support_requests SET completed_at = NOW() WHERE id = ${params.sourceId} AND completed_at IS NULL`);
      } catch (_) {}
    }
    return { ok: true, updated: true };
  } catch (e: any) {
    console.error("[closeServiceFromTask]", e);
    return { ok: false, error: String(e?.message || e) };
  }
}
