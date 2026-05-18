/**
 * cron-att-morning: 출근 미체크 알림 (KST 09:30 = UTC 00:30)
 * schedule: 30 0 * * *
 *
 * 동작:
 * 1. 오늘 attSchedules 기준 출근 예정 직원 중 attRecords 없는 직원 조회
 * 2. 해당 직원에게 인앱 알림 ("출근 체크가 완료되지 않았습니다")
 * 3. 슈퍼어드민(super_admin 역할)에게 미출근 요약 알림
 */

import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members, attRecords, attSchedules } from "../../db/schema";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

export const config = { schedule: "30 0 * * *" };

function kstToday(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export default async (_req: Request, _ctx: Context) => {
  const start = Date.now();
  const today = kstToday();
  console.info("[cron-att-morning] 시작", today);

  try {
    // 오늘 출근 스케줄 있는 운영자 목록 (attSchedules 기준)
    const scheduledRows: any = await db.execute(sql`
      SELECT DISTINCT s.member_uid::integer AS member_id
      FROM att_schedules s
      WHERE s.start_date <= ${today}::date
        AND (s.end_date IS NULL OR s.end_date >= ${today}::date)
    `);
    const scheduledIds: number[] = (Array.isArray(scheduledRows) ? scheduledRows : (scheduledRows as any).rows ?? [])
      .map((r: any) => parseInt(r.member_id))
      .filter((id: number) => !isNaN(id));

    if (!scheduledIds.length) {
      console.info("[cron-att-morning] 오늘 출근 예정 직원 없음");
      return new Response(JSON.stringify({ ok: true, message: "출근 예정 직원 없음" }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // 오늘 이미 출근 기록 있는 직원 조회
    const checkedInRows: any = await db.execute(sql`
      SELECT member_uid::integer AS member_id
      FROM att_records
      WHERE date = ${today}::date
        AND member_uid::integer = ANY(ARRAY[${sql.raw(scheduledIds.join(","))}])
    `);
    const checkedInIds = new Set<number>(
      (Array.isArray(checkedInRows) ? checkedInRows : (checkedInRows as any).rows ?? [])
        .map((r: any) => parseInt(r.member_id))
    );

    // 미출근 직원
    const absentIds = scheduledIds.filter(id => !checkedInIds.has(id));
    if (!absentIds.length) {
      console.info("[cron-att-morning] 전원 출근 완료");
      return new Response(JSON.stringify({ ok: true, message: "전원 출근 완료", absentCount: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // 미출근 직원 이름 조회
    const absentMembers = await db
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(inArray(members.id, absentIds));

    // 개인 알림 발송
    for (const m of absentMembers) {
      try {
        await sendWorkspaceNotification({
          memberId: m.id,
          sourceType: "event" as any,
          sourceId: 0,
          notifType: "reminder_3d" as any,
          channel: "bell" as any,
          title: "출근 체크 미완료",
          body: `${today} 출근 체크가 완료되지 않았습니다. 앱에서 출근 처리해 주세요.`,
          actionUrl: "/workspace-attendance.html",
          category: "system" as any,
        });
      } catch (err) {
        console.warn(`[cron-att-morning] 알림 실패 memberId=${m.id}:`, err);
      }
    }

    // 슈퍼어드민 요약 알림
    const superAdmins = await db
      .select({ id: members.id })
      .from(members)
      .where(and(
        eq(members.role as any, "super_admin"),
        eq(members.operatorActive as any, true),
        isNull(members.withdrawnAt),
      ))
      .limit(10);

    const absentNames = absentMembers.map(m => m.name).join(", ");
    for (const sa of superAdmins) {
      try {
        await sendWorkspaceNotification({
          memberId: sa.id,
          sourceType: "event" as any,
          sourceId: 0,
          notifType: "reminder_3d" as any,
          channel: "bell" as any,
          title: `[근태] 미출근 ${absentIds.length}명`,
          body: `${today} 출근 미체크: ${absentNames}`,
          actionUrl: "/admin-attendance-settings.html",
          category: "system" as any,
        });
      } catch (err) {
        console.warn(`[cron-att-morning] 슈퍼어드민 알림 실패:`, err);
      }
    }

    const durationMs = Date.now() - start;
    console.info(`[cron-att-morning] 완료 미출근 ${absentIds.length}명 (${durationMs}ms)`);

    return new Response(JSON.stringify({
      ok: true, absentCount: absentIds.length, absentNames, durationMs,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[cron-att-morning] 오류:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message ?? err) }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
