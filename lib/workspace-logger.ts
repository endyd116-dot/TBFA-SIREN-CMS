// lib/workspace-logger.ts
// ★ Phase 3 — 워크스페이스 활동 로그 + 알림 통합 헬퍼
// 모든 워크스페이스 변경 사항을 Activity Log + Notification 양쪽에 기록
//
// 사용법:
//   import { logWorkspaceActivity, sendWorkspaceNotification } from "../../lib/workspace-logger";
//
//   await logWorkspaceActivity({
//     actorId: adminMember.id,
//     actorName: adminMember.name,
//     actionType: "task.create",
//     targetType: "task",
//     targetId: newTask.id,
//     targetTitle: newTask.title,
//     metadata: { priority: newTask.priority, dueDate: newTask.dueDate },
//     visibility: "team",
//   });

import { db } from "../db";
import { workspaceActivityLog, workspaceNotifications, members, NewWorkspaceActivityLog, NewWorkspaceNotification } from "../db/schema";
import { eq } from "drizzle-orm";
import { dispatch } from "./notify-dispatcher";
import { NotifyEvent } from "./notify-events";

/* ════════════════════════════════════════════════
   Type 정의
═══════════════════════════════════════════════ */

export type ActivityActionType =
  // Task
  | "task.create" | "task.update" | "task.delete"
  | "task.status" | "task.complete" | "task.reopen"
  | "task.assign" | "task.unassign"
  | "task.checklist.add" | "task.checklist.toggle"
  | "task.attachment.add" | "task.attachment.remove"
  | "task.hold" | "task.unhold" | "task.archive" | "task.unarchive"
  // Event
  | "event.create" | "event.update" | "event.delete"
  | "event.rsvp.accept" | "event.rsvp.decline"
  | "event.recurring.generate"
  // Memo
  | "memo.create" | "memo.update" | "memo.delete" | "memo.pin"
  // Due date
  | "due.request" | "due.approve" | "due.reject" | "due.cancel"
  // AI Agent
  | "agent.task.create" | "agent.briefing.generate" | "agent.reminder.send";

export type ActivityTargetType = "task" | "event" | "memo" | "due_request" | "briefing";
export type ActivityVisibility = "private" | "team" | "public";

export interface LogActivityParams {
  actorId: number | null;
  actorName?: string | null;
  actionType: ActivityActionType;
  targetType?: ActivityTargetType;
  targetId?: number;
  targetTitle?: string;
  metadata?: Record<string, any>;
  visibility?: ActivityVisibility;
}

export type NotifSourceType = "task" | "event" | "due_change" | "briefing";
export type NotifChannel = "bell" | "email" | "sms" | "kakao";
export type NotifType =
  | "reminder_3d" | "reminder_1d" | "reminder_2h"
  | "overdue" | "assigned" | "approved" | "rejected"
  | "invited" | "status_changed" | "completed";

/** ⭐ Phase 21 R2+R3 — 알림 카테고리 (분류 — 드롭다운 색·필터용)
 *  assign / due / mention / transfer / watcher / system
 *  notifType (reminder/assigned 등)와 별개 개념 */
export type NotifCategory = "assign" | "due" | "mention" | "transfer" | "watcher" | "system";

export interface NotifParams {
  memberId: number;
  sourceType: NotifSourceType;
  sourceId: number;
  notifType: NotifType;
  channel: NotifChannel;
  title: string;
  body?: string | null;
  actionUrl?: string;
  category?: NotifCategory | null;
}

/* ════════════════════════════════════════════════
   1. logWorkspaceActivity — Activity Log 기록
═══════════════════════════════════════════════ */

export async function logWorkspaceActivity(params: LogActivityParams): Promise<void> {
  try {
    // actorName이 없으면 members 테이블에서 자동 조회
    let actorName = params.actorName;
    if (!actorName && params.actorId) {
      const [m] = await db
        .select({ name: members.name })
        .from(members)
        .where(eq(members.id, params.actorId))
        .limit(1);
      actorName = m?.name || null;
    }

    await db.insert(workspaceActivityLog).values({
      actorId: params.actorId ?? null,
      actorName: actorName ?? null,
      actionType: params.actionType,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      targetTitle: params.targetTitle ?? null,
      metadata: params.metadata ?? {},
      visibility: params.visibility ?? "team",
    } as any);
  } catch (err) {
    // 로그 실패는 메인 흐름 방해 X
    console.error("[WorkspaceActivityLog Failed]", err, params);
  }
}

/* ════════════════════════════════════════════════
   2. sendWorkspaceNotification — 알림 발송 + DB 기록
═══════════════════════════════════════════════ */

export async function sendWorkspaceNotification(params: NotifParams): Promise<number | null> {
  try {
    const [row] = await db
      .insert(workspaceNotifications)
      .values({
        memberId: params.memberId,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        notifType: params.notifType,
        channel: params.channel,
        title: params.title,
        body: params.body ?? null,
        actionUrl: params.actionUrl ?? null,
        category: params.category ?? null,
        deliveryStatus: "sent",
      } as any)
      .returning({ id: workspaceNotifications.id });

    /* Phase 8 — 통합 디스패처 호출 (fire-and-forget)
       workspace_notifications INSERT는 워크스페이스 UI 벨용으로 유지하고,
       추가로 통합 알림(notifications 테이블) 및 채널 정책(현재 inapp 단일)을 따른다. */
    dispatch({
      event: NotifyEvent.WORKSPACE_ACTIVITY,
      target: { type: "member", id: params.memberId },
      params: {
        title:    params.title,
        message:  params.body,
        link:     params.actionUrl,
        category: "workspace",
        severity: "info",
        refTable: "workspace_notifications",
        refId:    row?.id,
        sourceType: params.sourceType,
        sourceId:   params.sourceId,
        notifType:  params.notifType,
      },
    });

    return row?.id ?? null;
  } catch (err) {
    console.error("[WorkspaceNotification Failed]", err, params);
    return null;
  }
}

/* ════════════════════════════════════════════════
   3. 편의 함수 — 대량 공지 (여러 member 한 번에)
═══════════════════════════════════════════════ */

export async function broadcastNotification(
  memberIds: number[],
  params: Omit<NotifParams, "memberId">
): Promise<void> {
  if (memberIds.length === 0) return;

  try {
    const rows = memberIds.map(mid => ({
      memberId: mid,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      notifType: params.notifType,
      channel: params.channel,
      title: params.title,
      body: params.body ?? null,
      actionUrl: params.actionUrl ?? null,
      category: params.category ?? null,
      deliveryStatus: "sent" as const,
    }));

    await db.insert(workspaceNotifications).values(rows);
  } catch (err) {
    console.error("[BroadcastNotification Failed]", err, params);
  }
}

/* ════════════════════════════════════════════════
   4. 통합 헬퍼 — 변경 + 로그 + 알림 한번에
   (자주 쓰이는 패턴을 1줄로 단축)
═══════════════════════════════════════════════ */

export interface TaskChangeLogParams {
  actorId: number;
  actorName?: string | null;
  taskId: number;
  taskTitle: string;
  actionType: ActivityActionType;
  metadata?: Record<string, any>;
  // 알림 대상(assignee, creator 등)
  notifyMemberIds?: number[];
  notifyTitle?: string;
  notifyBody?: string;
  notifyType?: NotifType;
  actionUrl?: string;
}

export async function logTaskChange(params: TaskChangeLogParams): Promise<void> {
  // 1. Activity Log
  await logWorkspaceActivity({
    actorId: params.actorId,
    actorName: params.actorName,
    actionType: params.actionType,
    targetType: "task",
    targetId: params.taskId,
    targetTitle: params.taskTitle,
    metadata: params.metadata ?? {},
    visibility: "team",
  });

  // 2. 알림 (대상이 있으면)
  if (params.notifyMemberIds && params.notifyMemberIds.length > 0) {
    await broadcastNotification(params.notifyMemberIds, {
      sourceType: "task",
      sourceId: params.taskId,
      notifType: params.notifyType ?? "status_changed",
      channel: "bell",
      title: params.notifyTitle ?? params.taskTitle,
      body: params.notifyBody,
      // [감사#29] 죽은 해시 /admin#task-N → 실제 칸반 딥링크
      actionUrl: params.actionUrl ?? `/workspace-kanban.html#task=${params.taskId}`,
    });
  }
}

/* ════════════════════════════════════════════════
   5. 팀 피드 조회 헬퍼 (팀원 활동 타임라인)
═══════════════════════════════════════════════ */

export interface FeedQueryParams {
  limit?: number;
  actorId?: number;  // 특정 운영자만
  actionType?: ActivityActionType;
  targetType?: ActivityTargetType;
  visibility?: ActivityVisibility | ActivityVisibility[];
  since?: Date;
}

/**
 * 팀 피드 조회 (운영자 대시보드에 표시할 최근 활동)
 * 주의: 실제 쿼리는 API에서 drizzle로 직접 수행. 이 함수는 공통 조건만 캡슐화.
 */
export function buildFeedWhereClause(params: FeedQueryParams): Record<string, any> {
  const conditions: Record<string, any> = {};
  if (params.actorId) conditions.actorId = params.actorId;
  if (params.actionType) conditions.actionType = params.actionType;
  if (params.targetType) conditions.targetType = params.targetType;
  if (params.visibility) conditions.visibility = params.visibility;
  if (params.since) conditions.since = params.since;
  return conditions;
}

/* ════════════════════════════════════════════════
   6. 액션 타입 한글 라벨 매핑 (UI용)
═══════════════════════════════════════════════ */

export const ACTION_LABELS: Record<ActivityActionType, string> = {
  "task.create": "작업 생성",
  "task.update": "작업 수정",
  "task.delete": "작업 삭제",
  "task.status": "상태 변경",
  "task.complete": "작업 완료",
  "task.reopen": "작업 재개",
  "task.assign": "작업 지시",
  "task.unassign": "지시 취소",
  "task.checklist.add": "체크리스트 추가",
  "task.checklist.toggle": "체크리스트 완료",
  "task.attachment.add": "첨부 추가",
  "task.attachment.remove": "첨부 제거",
  "task.hold": "작업 보류",
  "task.unhold": "보류 해제",
  "task.archive": "작업 보관",
  "task.unarchive": "보관 해제",
  "event.create": "일정 등록",
  "event.update": "일정 수정",
  "event.delete": "일정 삭제",
  "event.rsvp.accept": "참석 수락",
  "event.rsvp.decline": "참석 거절",
  "event.recurring.generate": "반복 일정 생성",
  "memo.create": "메모 작성",
  "memo.update": "메모 수정",
  "memo.delete": "메모 삭제",
  "memo.pin": "메모 고정",
  "due.request": "마감일 변경 요청",
  "due.approve": "마감일 변경 승인",
  "due.reject": "마감일 변경 반려",
  "due.cancel": "마감일 변경 요청 취소",
  "agent.task.create": "AI 자동 생성",
  "agent.briefing.generate": "일일 브리핑 생성",
  "agent.reminder.send": "자동 알림 발송",
};

export function labelForAction(actionType: string): string {
  return ACTION_LABELS[actionType as ActivityActionType] ?? actionType;
}
