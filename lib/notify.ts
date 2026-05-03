// lib/notify.ts
// ★ Phase M-3: 알림 생성/조회 헬퍼
// - 후속 STEP에서 createNotification(...) 한 줄로 알림 발생
// - notifyMany(...)로 다중 수신자 일괄 발송
// - 모든 호출은 try-catch로 격리되어야 함 (알림 실패가 본 작업 막지 않음)

import { db } from "../db";
import { notifications, members } from "../db/schema";
import { eq, and, inArray } from "drizzle-orm";

export type NotifyCategory =
  | "support" | "donation" | "chat" | "audit"
  | "system" | "billing" | "member";

export type NotifySeverity = "info" | "warning" | "critical";

export type NotifyRecipientType = "user" | "admin" | "operator";

export interface CreateNotifyParams {
  recipientId: number;
  recipientType?: NotifyRecipientType;
  category: NotifyCategory;
  severity?: NotifySeverity;
  title: string;
  message?: string;
  link?: string;
  refTable?: string;
  refId?: number;
  expiresInDays?: number; // 기본 90일
}

/**
 * 단일 알림 생성
 */
export async function createNotification(p: CreateNotifyParams): Promise<number | null> {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (p.expiresInDays ?? 90));

    const data: any = {
      recipientId: p.recipientId,
      recipientType: p.recipientType || "user",
      category: p.category,
      severity: p.severity || "info",
      title: String(p.title || "").slice(0, 200),
      message: p.message ? String(p.message).slice(0, 500) : null,
      link: p.link ? String(p.link).slice(0, 500) : null,
      refTable: p.refTable || null,
      refId: p.refId || null,
      expiresAt,
    };

    const [row] = await db.insert(notifications).values(data).returning();
    return (row as any)?.id || null;
  } catch (e) {
    console.error("[notify.createNotification]", e);
    return null;
  }
}

/**
 * 다중 수신자에게 같은 알림 발송
 */
export async function notifyMany(
  recipientIds: number[],
  params: Omit<CreateNotifyParams, "recipientId">,
): Promise<number> {
  if (!recipientIds || recipientIds.length === 0) return 0;
  let count = 0;
  for (const id of recipientIds) {
    const r = await createNotification({ ...params, recipientId: id });
    if (r) count++;
  }
  return count;
}

/**
 * 모든 super_admin에게 알림 (크리티컬 이벤트용)
 */
export async function notifyAllSuperAdmins(
  params: Omit<CreateNotifyParams, "recipientId" | "recipientType">,
): Promise<number> {
  try {
    const admins = await db
      .select({ id: members.id })
      .from(members)
      .where(and(
        eq(members.type, "admin"),
        eq(members.role, "super_admin"),
        eq(members.status, "active"),
      ));

    return await notifyMany(
      admins.map((a: any) => a.id),
      { ...params, recipientType: "admin" }
    );
  } catch (e) {
    console.error("[notify.notifyAllSuperAdmins]", e);
    return 0;
  }
}

/**
 * 알림 수신 동의한 운영자 전원에게 알림
 */
export async function notifyAllOperators(
  params: Omit<CreateNotifyParams, "recipientId" | "recipientType">,
  filter?: { onlyNotifyOnSupport?: boolean },
): Promise<number> {
  try {
    const conds: any[] = [
      eq(members.type, "admin"),
      eq(members.status, "active"),
      eq(members.operatorActive, true),
    ];
    if (filter?.onlyNotifyOnSupport) {
      conds.push(eq(members.notifyOnSupport, true));
    }

    const ops = await db
      .select({ id: members.id })
      .from(members)
      .where(and(...conds));

    return await notifyMany(
      ops.map((o: any) => o.id),
      { ...params, recipientType: "operator" }
    );
  } catch (e) {
    console.error("[notify.notifyAllOperators]", e);
    return 0;
  }
}