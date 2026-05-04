// lib/grade-calculator.ts
// ★ Phase M-19-1: 회원 등급 자동 산정 로직
//
// 핵심 함수:
// - recalculateGrade(memberId): 단일 회원 재계산 (후원 완료 시 훅)
// - recalculateAllGrades(): cron용 일괄 재계산
// - setMemberGradeManual(): 운영자 수동 지정 (잠금 옵션)
// - getGradeForStats(): 누적/개월수 → 등급 매핑

import { eq, and, sql, desc, ne } from "drizzle-orm";
import { db } from "../db";
import { members, donations, memberGrades, billingKeys } from "../db/schema";
import { createNotification } from "./notify";
import { sendEmail, tplGradeUpgrade } from "./email";

/* ───────── 1. 등급 결정 ───────── */
export async function getGradeForStats(
  totalAmount: number,
  regularMonths: number,
): Promise<{ id: number; code: string; nameKo: string; icon: string; sortOrder: number } | null> {
  const grades: any[] = await db
    .select()
    .from(memberGrades)
    .orderBy(desc(memberGrades.sortOrder));

  for (const g of grades) {
    const minAmt = Number(g.minTotalAmount) || 0;
    const minMonths = Number(g.minRegularMonths) || 0;

    if (g.code === "beacon") {
      if (totalAmount >= minAmt && minAmt > 0) return g;
      continue;
    }

    if (minAmt === 0 && minMonths === 0) return g;

    if (totalAmount >= minAmt || regularMonths >= minMonths) {
      return g;
    }
  }
  return null;
}

/* ───────── 2. 단일 회원 재계산 ───────── */
export async function recalculateGrade(memberId: number): Promise<{
  updated: boolean;
  oldGradeId: number | null;
  newGradeId: number | null;
  newCode?: string;
  isUpgrade?: boolean;
}> {
  try {
    const [member] = await db
      .select()
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);

    if (!member) {
      return { updated: false, oldGradeId: null, newGradeId: null };
    }

    if (member.type === "admin" || member.status === "withdrawn") {
      return { updated: false, oldGradeId: member.gradeId, newGradeId: member.gradeId };
    }

    if (member.gradeLocked) {
      const totalAmount = await sumCompletedDonations(memberId);
      const regularMonths = await calcRegularMonths(memberId);
      await db
        .update(members)
        .set({
          totalDonationAmount: totalAmount,
          regularMonthsCount: regularMonths,
          updatedAt: new Date(),
        } as any)
        .where(eq(members.id, memberId));
      return { updated: false, oldGradeId: member.gradeId, newGradeId: member.gradeId };
    }

    const totalAmount = await sumCompletedDonations(memberId);
    const regularMonths = await calcRegularMonths(memberId);

    const newGrade = await getGradeForStats(totalAmount, regularMonths);
    const oldGradeId = member.gradeId;
    const newGradeId = newGrade?.id || null;
    const isChanged = oldGradeId !== newGradeId;

    await db
      .update(members)
      .set({
        totalDonationAmount: totalAmount,
        regularMonthsCount: regularMonths,
        gradeId: newGradeId,
        gradeAssignedAt: isChanged ? new Date() : (member as any).gradeAssignedAt,
        updatedAt: new Date(),
      } as any)
      .where(eq(members.id, memberId));

    let isUpgrade = false;
    if (isChanged && newGrade) {
      isUpgrade = await isGradeUpgrade(oldGradeId, newGradeId);

      if (isUpgrade) {
        try {
          await createNotification({
            recipientId: memberId,
            recipientType: "user",
            category: "member",
            severity: "info",
            title: `${newGrade.icon} 회원 등급이 상승했습니다 — ${newGrade.nameKo}`,
            message: `${member.name}님의 따뜻한 동행에 깊이 감사드립니다.`,
            link: "/mypage.html",
          });
        } catch (e) {
          console.error("[grade.notify]", e);
        }

        if (member.agreeEmail !== false && member.email) {
          try {
            const tpl = tplGradeUpgrade({
              userName: member.name,
              gradeName: newGrade.nameKo,
              gradeIcon: newGrade.icon,
              totalAmount,
              regularMonths,
            });
            await sendEmail({
              to: member.email,
              subject: tpl.subject,
              html: tpl.html,
            });
          } catch (e) {
            console.error("[grade.email]", e);
          }
        }
      }
    }

    return { updated: isChanged, oldGradeId, newGradeId, newCode: newGrade?.code, isUpgrade };
  } catch (e) {
    console.error("[grade-calculator.recalculateGrade]", e);
    return { updated: false, oldGradeId: null, newGradeId: null };
  }
}

/* ───────── 3. 등급 상승 여부 ───────── */
async function isGradeUpgrade(oldId: number | null, newId: number | null): Promise<boolean> {
  if (!newId) return false;
  if (!oldId) return true;

  const ids = [oldId, newId];
  const grades: any[] = await db
    .select({ id: memberGrades.id, sortOrder: memberGrades.sortOrder })
    .from(memberGrades)
    .where(sql`${memberGrades.id} IN (${sql.join(ids.map((i) => sql`${i}`), sql`,`)})`);

  const oldOrder = grades.find((g) => g.id === oldId)?.sortOrder ?? 0;
  const newOrder = grades.find((g) => g.id === newId)?.sortOrder ?? 0;
  return newOrder > oldOrder;
}

/* ───────── 4. 누적 후원 합계 ───────── */
async function sumCompletedDonations(memberId: number): Promise<number> {
  try {
    const [stats] = await db
      .select({ totalAmount: sql<number>`COALESCE(SUM(${donations.amount}), 0)` })
      .from(donations)
      .where(and(
        eq(donations.memberId, memberId),
        eq(donations.status, "completed"),
      ));
    return Number(stats?.totalAmount ?? 0);
  } catch (e) {
    return 0;
  }
}

/* ───────── 5. 정기 후원 개월 수 ───────── */
async function calcRegularMonths(memberId: number): Promise<number> {
  let months = 0;

  try {
    const [bk] = await db
      .select({ createdAt: billingKeys.createdAt })
      .from(billingKeys)
      .where(and(
        eq(billingKeys.memberId, memberId),
        eq(billingKeys.isActive, true),
      ))
      .limit(1);

    if (bk?.createdAt) {
      const m = Math.floor(
        (Date.now() - new Date(bk.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30),
      );
      months = Math.max(months, m);
    }
  } catch (_) {}

  try {
    const [hyo] = await db
      .select({ firstAt: sql<Date>`MIN(${donations.createdAt})` })
      .from(donations)
      .where(and(
        eq(donations.memberId, memberId),
        eq(donations.pgProvider, "hyosung_cms"),
        eq(donations.type, "regular"),
        eq(donations.status, "completed"),
      ));

    if (hyo?.firstAt) {
      const m = Math.floor(
        (Date.now() - new Date(hyo.firstAt).getTime()) / (1000 * 60 * 60 * 24 * 30),
      );
      months = Math.max(months, m);
    }
  } catch (_) {}

  return months;
}

/* ───────── 6. 전체 회원 일괄 재계산 (cron) ───────── */
export async function recalculateAllGrades(): Promise<{
  total: number;
  updated: number;
  upgraded: number;
  errors: number;
}> {
  let total = 0;
  let updated = 0;
  let upgraded = 0;
  let errors = 0;

  try {
    const list: any[] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(
        ne(members.type, "admin"),
        ne(members.status, "withdrawn"),
      ));

    total = list.length;

    for (const m of list) {
      try {
        const r = await recalculateGrade(m.id);
        if (r.updated) updated++;
        if (r.isUpgrade) upgraded++;
      } catch (e) {
        errors++;
      }
    }

    return { total, updated, upgraded, errors };
  } catch (e) {
    console.error("[grade-calculator.recalculateAllGrades]", e);
    return { total, updated, upgraded, errors };
  }
}

/* ───────── 7. 운영자 수동 등급 변경 ───────── */
export async function setMemberGradeManual(
  memberId: number,
  gradeId: number | null,
  lock: boolean,
): Promise<boolean> {
  try {
    await db
      .update(members)
      .set({
        gradeId,
        gradeLocked: lock,
        gradeAssignedAt: new Date(),
        updatedAt: new Date(),
      } as any)
      .where(eq(members.id, memberId));
    return true;
  } catch (e) {
    console.error("[grade-calculator.setMemberGradeManual]", e);
    return false;
  }
}