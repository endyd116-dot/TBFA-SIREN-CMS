/**
 * lib/workspace-sync.ts — Phase 21 R2+R3
 * 서비스 ↔ 카드 양방향 동기화 + R&R 기반 자동 할당 + 토스
 *
 * 핵심:
 *   - resolveAssigneeByService: R&R + 부재 체크 + Fallback 으로 담당자 결정
 *   - createWorkspaceTaskFromService: 서비스 접수 시 카드 자동 생성
 *   - transferWorkspaceTask: 토스 (이력 + 카드 갱신 + 알림 + 활동 로그)
 *   - syncAssigneeFromService: 서비스 담당자 변경 → 카드 동기 (origin="service")
 *   - closeServiceFromTask: 카드 done → 서비스 closed (origin="card")
 *   - closeTaskFromService: 서비스 closed → 카드 done (origin="service")
 *
 * 무한 루프 방지: 모듈 레벨 _activeSync Set 으로 (kind, id, origin) 잠시 잠금.
 *   DB 컬럼 추가 없이 같은 요청 호출 체인에서 다시 반대 방향으로 호출돼도 즉시 return.
 */

import { eq, and, sql, isNull, isNotNull } from "drizzle-orm";
import { db } from "../db";
import {
  members,
  workspaceTasks,
  workspaceTaskTransfers,
  serviceRnr,
  incidentReports,
  harassmentReports,
  legalConsultations,
  supportRequests,
} from "../db/schema";
import {
  logWorkspaceActivity,
  sendWorkspaceNotification,
} from "./workspace-logger";

/* ════════════════════════════════════════════════
   Types
═══════════════════════════════════════════════ */

export type ServiceKind = "incident" | "harassment" | "legal" | "support";
export type SyncOrigin  = "service" | "card";

export interface AssigneeResolution {
  uid: number;
  via: "primary" | "backup" | "fallback";
  primaryUid: number | null;
  primaryWasOutOfOffice: boolean;
}

/* ════════════════════════════════════════════════
   무한 루프 방지 — 모듈 레벨 잠금
   key: `${kind}:${id}:${origin}`
═══════════════════════════════════════════════ */

const _activeSync = new Set<string>();

function lockKey(kind: string, id: number, origin: SyncOrigin): string {
  return `${kind}:${id}:${origin}`;
}

function tryLock(kind: string, id: number, origin: SyncOrigin): boolean {
  const key = lockKey(kind, id, origin);
  if (_activeSync.has(key)) return false;
  _activeSync.add(key);
  return true;
}

function releaseLock(kind: string, id: number, origin: SyncOrigin): void {
  _activeSync.delete(lockKey(kind, id, origin));
}

/* ════════════════════════════════════════════════
   1. resolveAssigneeByService
   R&R 매핑 + 부재 체크 + Fallback
═══════════════════════════════════════════════ */

export async function resolveAssigneeByService(opts: {
  serviceKind: ServiceKind;
  serviceCategory?: string | null;
}): Promise<AssigneeResolution | null> {
  const { serviceKind, serviceCategory } = opts;

  /* 1) 세분류 매핑 우선, 없으면 대분류(null) 매핑 시도 */
  const candidates: Array<{ kind: string; category: string | null }> = [];
  if (serviceCategory) candidates.push({ kind: serviceKind, category: serviceCategory });
  candidates.push({ kind: serviceKind, category: null });

  let primaryUid: number | null = null;
  let backupUid: number | null = null;

  for (const c of candidates) {
    const rows = await db
      .select({
        primaryUid: serviceRnr.primaryUid,
        backupUid:  serviceRnr.backupUid,
      })
      .from(serviceRnr)
      .where(
        c.category === null
          ? and(eq(serviceRnr.serviceKind, c.kind), isNull(serviceRnr.serviceCategory))
          : and(eq(serviceRnr.serviceKind, c.kind), eq(serviceRnr.serviceCategory, c.category))
      )
      .limit(1);
    if (rows[0]) {
      primaryUid = rows[0].primaryUid ?? null;
      backupUid  = rows[0].backupUid ?? null;
      break;
    }
  }

  /* 2) 1차 담당자 부재 체크 */
  let primaryWasOutOfOffice = false;
  if (primaryUid) {
    const isOut = await isMemberOutOfOffice(primaryUid);
    if (!isOut) {
      return { uid: primaryUid, via: "primary", primaryUid, primaryWasOutOfOffice: false };
    }
    primaryWasOutOfOffice = true;
  }

  /* 3) 백업 사용 */
  if (backupUid) {
    const isBackupOut = await isMemberOutOfOffice(backupUid);
    if (!isBackupOut) {
      return { uid: backupUid, via: "backup", primaryUid, primaryWasOutOfOffice };
    }
  }

  /* 4) Fallback 슬롯 */
  const fb = await db
    .select({ primaryUid: serviceRnr.primaryUid })
    .from(serviceRnr)
    .where(eq(serviceRnr.isFallback, true))
    .limit(1);
  const fbUid = fb[0]?.primaryUid ?? null;
  if (fbUid) {
    return { uid: fbUid, via: "fallback", primaryUid, primaryWasOutOfOffice };
  }

  /* 5) 미할당 풀 */
  return null;
}

/**
 * 부재 체크: out_of_office 컬럼이 true 이거나, start ≤ today ≤ end 인 경우.
 * cron 없이 쿼리 시점 계산 (CLAUDE 결정사항 — §8 R3).
 */
async function isMemberOutOfOffice(memberId: number): Promise<boolean> {
  const rows: any = await db.execute(sql`
    SELECT
      COALESCE(out_of_office, FALSE) AS flag,
      out_of_office_start AS start_date,
      out_of_office_end   AS end_date
    FROM members
    WHERE id = ${memberId}
    LIMIT 1
  `);
  const row = Array.isArray(rows) ? rows[0] : (rows as any).rows?.[0];
  if (!row) return false;
  if (row.flag === true) {
    /* 명시 토글 true */
    if (row.start_date && row.end_date) {
      const today = new Date();
      const start = new Date(row.start_date);
      const end   = new Date(row.end_date);
      end.setHours(23, 59, 59, 999);
      return today >= start && today <= end;
    }
    return true;
  }
  /* 명시 토글 false 라도 기간 자동 계산 */
  if (row.start_date && row.end_date) {
    const today = new Date();
    const start = new Date(row.start_date);
    const end   = new Date(row.end_date);
    end.setHours(23, 59, 59, 999);
    return today >= start && today <= end;
  }
  return false;
}

/* ════════════════════════════════════════════════
   2. createWorkspaceTaskFromService
   서비스 접수 시 카드 자동 생성
   - sourceType / sourceId 활용 (sourceServiceKind/Id 별도 추가 X)
═══════════════════════════════════════════════ */

export async function createWorkspaceTaskFromService(opts: {
  serviceKind: ServiceKind;
  serviceId: number;
  category?: string | null;
  title: string;
  priority?: "low" | "normal" | "high" | "urgent";
  dueDate?: Date | null;
  description?: string | null;
  sourceRefUrl?: string | null;
}): Promise<number | null> {
  try {
    const resolved = await resolveAssigneeByService({
      serviceKind: opts.serviceKind,
      serviceCategory: opts.category ?? null,
    });

    /* 담당자 결정 (없으면 미할당) */
    const assigneeUid: number | null = resolved?.uid ?? null;

    /* 마감일 기본값 — 3일 후 (필수 컬럼) */
    const dueDate = opts.dueDate ?? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    /* 카드 INSERT
       - memberId(소유자): 담당자 또는 fallback uid (NULL 불가)
         → 미할당이면 시스템 슬롯이 없으므로 임시로 1번 슈퍼관리자에 소유 (운영 시 R&R Fallback 슬롯 권장)
         → 더 안전한 방향: super_admin 1명 조회 */
    const ownerUid = assigneeUid ?? (await findAnySuperAdminUid()) ?? 1;

    const inserted: any = await db
      .insert(workspaceTasks)
      .values({
        memberId: ownerUid,
        title: opts.title.slice(0, 300),
        description: opts.description ?? null,
        status: "todo",
        priority: opts.priority ?? "normal",
        dueDate,
        assignedBy: ownerUid,
        assignedTo: assigneeUid,
        assignedAt: assigneeUid ? new Date() : null,
        sourceType: opts.serviceKind,
        sourceId: opts.serviceId,
        sourceRefUrl: opts.sourceRefUrl ?? null,
        createdByAgent: "agent-rnr",
      } as any)
      .returning({ id: workspaceTasks.id });

    const taskId = inserted[0]?.id;
    if (!taskId) return null;

    /* 활동 로그 */
    await logWorkspaceActivity({
      actorId: null,
      actorName: "R&R 자동",
      actionType: "agent.task.create" as any,
      targetType: "task",
      targetId: taskId,
      targetTitle: opts.title,
      metadata: {
        serviceKind: opts.serviceKind,
        serviceId: opts.serviceId,
        category: opts.category ?? null,
        via: resolved?.via ?? "unassigned",
        primaryUid: resolved?.primaryUid ?? null,
        primaryWasOutOfOffice: resolved?.primaryWasOutOfOffice ?? false,
      },
      visibility: "team",
    });

    /* 알림 발송 — 담당자 */
    if (assigneeUid) {
      await sendWorkspaceNotification({
        memberId: assigneeUid,
        sourceType: "task",
        sourceId: taskId,
        notifType: "assigned",
        channel: "bell",
        title: `[${serviceKindLabel(opts.serviceKind)}] 새 카드 할당: ${opts.title.slice(0, 100)}`,
        body: opts.description?.slice(0, 200) ?? null,
        actionUrl: `/workspace-kanban.html#task=${taskId}`,
        category: "assign",
      });
    }

    /* 1차 부재로 백업이 받았으면 1차에게 복귀 후 확인 메모 */
    if (
      resolved?.via === "backup" &&
      resolved.primaryWasOutOfOffice &&
      resolved.primaryUid &&
      resolved.primaryUid !== assigneeUid
    ) {
      await sendWorkspaceNotification({
        memberId: resolved.primaryUid,
        sourceType: "task",
        sourceId: taskId,
        notifType: "status_changed",
        channel: "bell",
        title: `[복귀 후 확인] 부재 중 새 카드는 백업이 처리: ${opts.title.slice(0, 80)}`,
        body: "부재 기간 중 백업 담당자가 인계받았습니다. 복귀 후 진행 상황을 확인해주세요.",
        actionUrl: `/workspace-kanban.html#task=${taskId}`,
        category: "system",
      });
    }

    return taskId;
  } catch (err) {
    console.error("[workspace-sync] createWorkspaceTaskFromService failed:", err);
    return null;
  }
}

function serviceKindLabel(kind: ServiceKind): string {
  switch (kind) {
    case "incident":   return "신고";
    case "harassment": return "괴롭힘";
    case "legal":      return "법률";
    case "support":    return "지원";
    default:           return String(kind);
  }
}

async function findAnySuperAdminUid(): Promise<number | null> {
  const rows = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.type, "admin"), eq(members.status, "active")))
    .limit(1);
  return rows[0]?.id ?? null;
}

/* ════════════════════════════════════════════════
   3. transferWorkspaceTask — 토스
═══════════════════════════════════════════════ */

export async function transferWorkspaceTask(opts: {
  taskId: number;
  toUid: number;
  reason?: string | null;
  transferredBy: number;
}): Promise<{ transferId: number; fromUid: number | null; toUid: number } | null> {
  const { taskId, toUid, transferredBy } = opts;
  const reason = (opts.reason ?? "").trim().slice(0, 1000) || null;

  /* 카드 조회 */
  const [task]: any = await db
    .select()
    .from(workspaceTasks)
    .where(eq(workspaceTasks.id, taskId))
    .limit(1);
  if (!task) throw new Error("작업을 찾을 수 없습니다");

  const fromUid: number | null = task.assignedTo ?? null;
  if (fromUid === toUid) throw new Error("이미 동일 담당자입니다");

  /* 이력 INSERT */
  const ins: any = await db
    .insert(workspaceTaskTransfers)
    .values({
      taskId,
      fromUid,
      toUid,
      reason,
      transferredBy,
    } as any)
    .returning({ id: workspaceTaskTransfers.id });
  const transferId = Number(ins[0]?.id ?? 0);

  /* 카드 담당자 갱신 (assignedBy 는 최초 할당자 보존) */
  await db
    .update(workspaceTasks)
    .set({
      assignedTo: toUid,
      assignedAt: new Date(),
      updatedAt: new Date(),
    } as any)
    .where(eq(workspaceTasks.id, taskId));

  /* 활동 로그 */
  await logWorkspaceActivity({
    actorId: transferredBy,
    actionType: "task.assign",
    targetType: "task",
    targetId: taskId,
    targetTitle: task.title,
    metadata: {
      subType: "transfer",
      fromUid,
      toUid,
      reason,
      transferId,
    },
    visibility: "team",
  });

  /* 알림 — 받는 사람 */
  await sendWorkspaceNotification({
    memberId: toUid,
    sourceType: "task",
    sourceId: taskId,
    notifType: "assigned",
    channel: "bell",
    title: `[토스] 새 카드 인계: ${String(task.title).slice(0, 100)}`,
    body: reason ?? "사유 없이 인계",
    actionUrl: `/workspace-kanban.html#task=${taskId}`,
    category: "transfer",
  });

  /* 알림 — 보낸 사람 본인 외 원담당자가 다르면 알림 보조 (보통 본인이 보냄) */
  if (fromUid && fromUid !== transferredBy && fromUid !== toUid) {
    await sendWorkspaceNotification({
      memberId: fromUid,
      sourceType: "task",
      sourceId: taskId,
      notifType: "status_changed",
      channel: "bell",
      title: `카드가 다른 담당자에게 인계됨: ${String(task.title).slice(0, 100)}`,
      body: reason ?? null,
      actionUrl: `/workspace-kanban.html#task=${taskId}`,
      category: "transfer",
    });
  }

  /* OP-039: 워처에게도 인계 알림 — 카드를 관찰 등록한 사람이 담당자 변경을 통지받지 못하던 갭.
     마감 알림 cron(cron-workspace-due-reminder)은 워처를 수신자에 포함하는데 토스 경로엔 없었음.
     받는 사람·원담당자·실행자 본인은 제외(중복 방지). */
  try {
    const wres: any = await db.execute(sql`
      SELECT watcher_uid FROM workspace_task_watchers WHERE task_id = ${taskId}
    `);
    const wrows = Array.isArray(wres) ? wres : ((wres as any).rows ?? []);
    const exclude = new Set<number>([toUid, transferredBy, ...(fromUid ? [fromUid] : [])]);
    const watcherUids = Array.from(new Set(
      wrows
        .map((r: any) => Number(r.watcher_uid))
        .filter((n: number) => Number.isFinite(n) && n > 0 && !exclude.has(n))
    ));
    for (const w of watcherUids) {
      await sendWorkspaceNotification({
        memberId: w as number,
        sourceType: "task",
        sourceId: taskId,
        notifType: "status_changed",
        channel: "bell",
        title: `관찰 중인 카드가 인계됨: ${String(task.title).slice(0, 100)}`,
        body: reason ?? null,
        actionUrl: `/workspace-kanban.html#task=${taskId}`,
        category: "transfer",
      });
    }
  } catch (e: any) {
    console.warn("[transferWorkspaceTask] 워처 알림 실패:", e?.message || e);
  }

  return { transferId, fromUid, toUid };
}

/* ════════════════════════════════════════════════
   4. syncAssigneeFromService
   서비스 담당자 변경 → 카드 담당자 동기
   origin="service" 인 동안 카드 변경 후 다시 서비스 변경 호출이 와도 노옵
═══════════════════════════════════════════════ */

export async function syncAssigneeFromService(opts: {
  serviceKind: ServiceKind;
  serviceId: number;
  newAssigneeUid: number;
  reason?: string | null;
  changedBy: number;
}): Promise<void> {
  if (!tryLock(opts.serviceKind, opts.serviceId, "service")) return;
  try {
    /* 1) 서비스 담당자 갱신 */
    const serviceTable = pickServiceTable(opts.serviceKind);
    const assignField  = pickServiceAssignField(opts.serviceKind);

    await db.execute(sql.raw(
      `UPDATE ${serviceTable.tableName} SET ${assignField} = ${opts.newAssigneeUid} WHERE id = ${opts.serviceId}`
    ));

    /* 2) 연결 카드 조회 */
    const taskRow: any = await db.execute(sql.raw(
      `SELECT workspace_task_id FROM ${serviceTable.tableName} WHERE id = ${opts.serviceId} LIMIT 1`
    ));
    const taskId = extractFirst(taskRow)?.workspace_task_id ?? null;

    /* 3) 카드 담당자 갱신 (transfer 형식) */
    if (taskId) {
      const [task]: any = await db
        .select()
        .from(workspaceTasks)
        .where(eq(workspaceTasks.id, Number(taskId)))
        .limit(1);
      if (task && task.assignedTo !== opts.newAssigneeUid) {
        await db
          .insert(workspaceTaskTransfers)
          .values({
            taskId: Number(taskId),
            fromUid: task.assignedTo ?? null,
            toUid: opts.newAssigneeUid,
            reason: opts.reason ?? "(서비스 담당자 변경으로 자동 동기)",
            transferredBy: opts.changedBy,
          } as any);
        await db
          .update(workspaceTasks)
          .set({
            assignedTo: opts.newAssigneeUid,
            assignedAt: new Date(),
            updatedAt: new Date(),
          } as any)
          .where(eq(workspaceTasks.id, Number(taskId)));

        /* 활동 로그 + 알림 */
        await logWorkspaceActivity({
          actorId: opts.changedBy,
          actionType: "task.assign",
          targetType: "task",
          targetId: Number(taskId),
          targetTitle: String(task.title),
          metadata: {
            subType: "service-sync",
            serviceKind: opts.serviceKind,
            serviceId: opts.serviceId,
            fromUid: task.assignedTo ?? null,
            toUid: opts.newAssigneeUid,
          },
          visibility: "team",
        });
        await sendWorkspaceNotification({
          memberId: opts.newAssigneeUid,
          sourceType: "task",
          sourceId: Number(taskId),
          notifType: "assigned",
          channel: "bell",
          title: `[서비스 인계] ${serviceKindLabel(opts.serviceKind)} 카드 담당자 변경: ${String(task.title).slice(0, 80)}`,
          body: opts.reason ?? null,
          actionUrl: `/workspace-kanban.html#task=${taskId}`,
          category: "transfer",
        });
      }
    }
  } finally {
    releaseLock(opts.serviceKind, opts.serviceId, "service");
  }
}

/* ════════════════════════════════════════════════
   5. closeServiceFromTask
   카드 done → 원본 서비스 status closed
═══════════════════════════════════════════════ */

export async function closeServiceFromTask(opts: {
  taskId: number;
  closedBy?: number;
}): Promise<void> {
  /* 카드 조회 — sourceType / sourceId 로 원본 서비스 찾기 */
  const [task]: any = await db
    .select({
      sourceType: workspaceTasks.sourceType,
      sourceId:   workspaceTasks.sourceId,
      title:      workspaceTasks.title,
    })
    .from(workspaceTasks)
    .where(eq(workspaceTasks.id, opts.taskId))
    .limit(1);
  if (!task || !task.sourceType || !task.sourceId) return;

  const kind = task.sourceType as ServiceKind;
  if (!isServiceKind(kind)) return;

  if (!tryLock(kind, Number(task.sourceId), "card")) return;
  try {
    const serviceTable = pickServiceTable(kind);
    const closedStatus = pickClosedStatus(kind);

    /* 이미 closed 면 노옵 (idempotent) */
    const cur: any = await db.execute(sql.raw(
      `SELECT status FROM ${serviceTable.tableName} WHERE id = ${task.sourceId} LIMIT 1`
    ));
    const curStatus = extractFirst(cur)?.status ?? null;
    if (curStatus === closedStatus) return;

    await db.execute(sql.raw(
      `UPDATE ${serviceTable.tableName}
       SET status = '${closedStatus}',
           responded_at = COALESCE(responded_at, NOW()),
           responded_by = COALESCE(responded_by, ${opts.closedBy ?? "NULL"})
       WHERE id = ${task.sourceId}`
    ));
  } finally {
    releaseLock(kind, Number(task.sourceId), "card");
  }
}

/* ════════════════════════════════════════════════
   6. closeTaskFromService
   서비스 closed → 연결된 카드 done
═══════════════════════════════════════════════ */

export async function closeTaskFromService(opts: {
  serviceKind: ServiceKind;
  serviceId: number;
  closedBy?: number;
}): Promise<void> {
  if (!tryLock(opts.serviceKind, opts.serviceId, "service")) return;
  try {
    const serviceTable = pickServiceTable(opts.serviceKind);
    const row: any = await db.execute(sql.raw(
      `SELECT workspace_task_id FROM ${serviceTable.tableName} WHERE id = ${opts.serviceId} LIMIT 1`
    ));
    const taskId = extractFirst(row)?.workspace_task_id ?? null;
    if (!taskId) return;

    const [task]: any = await db
      .select({ id: workspaceTasks.id, status: workspaceTasks.status, title: workspaceTasks.title })
      .from(workspaceTasks)
      .where(eq(workspaceTasks.id, Number(taskId)))
      .limit(1);
    if (!task || task.status === "done") return;

    await db
      .update(workspaceTasks)
      .set({
        status: "done",
        completedAt: new Date(),
        completedBy: opts.closedBy ?? null,
        progress: 100,
        updatedAt: new Date(),
      } as any)
      .where(eq(workspaceTasks.id, Number(taskId)));

    await logWorkspaceActivity({
      actorId: opts.closedBy ?? null,
      actionType: "task.complete",
      targetType: "task",
      targetId: Number(taskId),
      targetTitle: String(task.title),
      metadata: {
        subType: "service-sync-close",
        serviceKind: opts.serviceKind,
        serviceId: opts.serviceId,
      },
      visibility: "team",
    });
  } finally {
    releaseLock(opts.serviceKind, opts.serviceId, "service");
  }
}

/* ════════════════════════════════════════════════
   내부 — 서비스 매핑
═══════════════════════════════════════════════ */

function isServiceKind(s: any): s is ServiceKind {
  return s === "incident" || s === "harassment" || s === "legal" || s === "support";
}

function pickServiceTable(kind: ServiceKind): { tableName: string } {
  switch (kind) {
    case "incident":   return { tableName: "incident_reports" };
    case "harassment": return { tableName: "harassment_reports" };
    case "legal":      return { tableName: "legal_consultations" };
    case "support":    return { tableName: "support_requests" };
  }
}

function pickServiceAssignField(kind: ServiceKind): string {
  /* support 만 assigned_admin_id (assignedMemberId 와 별개 — 운영자) */
  return kind === "support" ? "assigned_admin_id" : "assigned_to";
}

function pickClosedStatus(kind: ServiceKind): string {
  /* ★ Q3-002 fix: 4종 enum 별 종결 상태 — incident/harassment/legal enum에는 'completed'가 없고
     'closed'만 존재(schema.ts incident/harassment/legalConsultationStatusEnum). 'completed'는
     supportStatusEnum 전용. 기존엔 전부 'completed'를 반환해 신고 3종은 Postgres가 거부 → 종결 실패. */
  switch (kind) {
    case "incident":   return "closed";      // incidentReportStatusEnum
    case "harassment": return "closed";      // harassmentReportStatusEnum
    case "legal":      return "closed";      // legalConsultationStatusEnum
    case "support":    return "completed";   // supportStatusEnum
  }
}

function extractFirst(res: any): any {
  if (!res) return null;
  if (Array.isArray(res)) return res[0] ?? null;
  return (res as any).rows?.[0] ?? null;
}
