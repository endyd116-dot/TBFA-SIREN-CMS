// lib/notify.ts (헤더 영역)
// ★ Phase M-3: 알림 생성/조회 헬퍼
// - 후속 STEP에서 createNotification(...) 한 줄로 알림 발생
// - notifyMany(...)로 다중 수신자 일괄 발송
// - 모든 호출은 try-catch로 격리되어야 함 (알림 실패가 본 작업 막지 않음)
//
// ★ Phase M-15 패치:
// - notifyAllOperators(params, { category })로 카테고리별 분리 발송 지원
// - super_admin은 카테고리 무시하고 항상 전체 수신
// - operator는 assigned_categories(JSONB)에 해당 category 또는 'all' 포함 시 수신

import { db } from "../db";
import { notifications, members } from "../db/schema";
import { eq, and, or, inArray, sql } from "drizzle-orm";
export type NotifyCategory =
  | "support" | "donation" | "chat" | "audit"
  | "system" | "billing" | "member";

export type NotifySeverity = "info" | "warning" | "critical";

// lib/notify.ts — 타입 정의 섹션
export type NotifyRecipientType = "user" | "admin" | "operator";

/**
 * ★ M-15: 운영자 담당 카테고리
 * - 6개 도메인 + 'all' (메타값)
 * - members.assigned_categories JSONB 배열에 저장
 * - 'all' 포함 시 모든 카테고리 알림 수신
 */
export type OperatorCategory =
  | "incident"     // 사건 제보
  | "harassment"   // 악성민원 신고
  | "legal"        // 법률 상담
  | "board"        // 자유게시판
  | "donation"     // 후원
  | "support"      // 유가족 지원
  | "all";         // 전체 (메타)

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

// lib/notify.ts — notifyAllOperators 메서드 전체 교체
/**
 * 운영자 전원에게 알림 (super_admin은 항상 수신)
 *
 * ★ M-15 카테고리별 분리 발송:
 * - filter.category 지정 시:
 *   · super_admin: 항상 수신 (category 무시)
 *   · operator: assigned_categories에 해당 category 또는 'all' 포함 시 수신
 * - filter.category 미지정 시:
 *   · 모든 operator + super_admin 수신 (하위 호환, 기존 동작 유지)
 *
 * @param params         알림 본문 (title/message/link/category 등)
 * @param filter         필터 옵션
 *   - onlyNotifyOnSupport: notifyOnSupport=true인 운영자만 (지원 신청 알림 등)
 *   - category: 카테고리 분배 ('incident' | 'harassment' | ... | 'all')
 */
export async function notifyAllOperators(
  params: Omit<CreateNotifyParams, "recipientId" | "recipientType">,
  filter?: {
    onlyNotifyOnSupport?: boolean;
    category?: OperatorCategory;
  },
): Promise<number> {
  try {
    const recipientIds = new Set<number>();

    /* ===== 1. super_admin 추출 (category 무시, 항상 수신) ===== */
    const superAdminConds: any[] = [
      eq(members.type, "admin"),
      eq(members.status, "active"),
      eq(members.role, "super_admin"),
    ];
    /* super_admin도 operatorActive=false면 제외 (스스로 비활성화한 경우) */
    superAdminConds.push(eq(members.operatorActive, true));
    /* onlyNotifyOnSupport는 super_admin에도 적용 (의도적 옵트아웃 존중) */
    if (filter?.onlyNotifyOnSupport) {
      superAdminConds.push(eq(members.notifyOnSupport, true));
    }

    const superAdmins = await db
      .select({ id: members.id })
      .from(members)
      .where(and(...superAdminConds));
    for (const a of superAdmins as any[]) recipientIds.add(a.id);

    /* ===== 2. 일반 operator 추출 ===== */
    const operatorConds: any[] = [
      eq(members.type, "admin"),
      eq(members.status, "active"),
      eq(members.operatorActive, true),
      /* super_admin이 아닌 경우만 (위에서 이미 처리됨, 중복 방지) */
      sql`(${members.role} IS NULL OR ${members.role} <> 'super_admin')`,
    ];
    if (filter?.onlyNotifyOnSupport) {
      operatorConds.push(eq(members.notifyOnSupport, true));
    }

    /* category 지정 시: assigned_categories에 [category] 또는 ['all'] 포함 */
    if (filter?.category) {
      const cat = filter.category;
      operatorConds.push(
        sql`(
          ${members.assignedCategories} @> ${JSON.stringify([cat])}::jsonb
          OR ${members.assignedCategories} @> '["all"]'::jsonb
        )`
      );
    }

    const operators = await db
      .select({ id: members.id })
      .from(members)
      .where(and(...operatorConds));
    for (const o of operators as any[]) recipientIds.add(o.id);

    /* ===== 3. 일괄 발송 ===== */
    if (recipientIds.size === 0) return 0;

    return await notifyMany(
      Array.from(recipientIds),
      { ...params, recipientType: "operator" }
    );
  } catch (e) {
    console.error("[notify.notifyAllOperators]", e);
    return 0;
  }
}