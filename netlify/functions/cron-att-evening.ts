/**
 * cron-att-evening: 퇴근 미체크 + 재택보고서 알림 + 52시간 체크 (KST 자정 = UTC 15:00)
 * schedule: 0 15 * * *
 *
 * 동작:
 * 1. 오늘 출근 기록은 있으나 퇴근 null인 직원 → EARLY_LEAVE 자동 처리
 * 2. 재택근무자 중 보고서 미제출 직원 → 인앱 알림
 * 3. 주간 누적 48시간 임박 직원 → 임박 알림
 * 4. 주간 누적 52시간 초과 직원 → 슈퍼어드민 즉시 알림
 */

import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members, attRecords, attRemoteWorkReports } from "../../db/schema";
import { eq, and, isNull, inArray, isNotNull, sql } from "drizzle-orm";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

export const config = { schedule: "0 15 * * *" };

function kstToday(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function kstWeekStart(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = kst.getDay(); // 0=일,1=월,...
  const diff = day === 0 ? -6 : 1 - day;
  kst.setDate(kst.getDate() + diff);
  return kst.toISOString().slice(0, 10);
}

export default async (_req: Request, _ctx: Context) => {
  const start = Date.now();
  const today = kstToday();
  const weekStart = kstWeekStart();
  console.info("[cron-att-evening] 시작", today);

  let autoCheckoutCount = 0;
  let reportAlertCount = 0;
  let overtimeAlertCount = 0;

  try {
    // 1. 오늘 출근은 했으나 퇴근 기록 null인 직원 → EARLY_LEAVE 자동 처리
    const noCheckoutRows: any = await db.execute(sql`
      SELECT id, member_uid, check_in_time, work_mode
      FROM att_records
      WHERE date = ${today}::date
        AND check_in_time IS NOT NULL
        AND check_out_time IS NULL
    `);
    const noCheckoutList = Array.isArray(noCheckoutRows) ? noCheckoutRows : (noCheckoutRows as any).rows ?? [];

    for (const row of noCheckoutList) {
      try {
        await db.execute(sql`
          UPDATE att_records
          SET check_out_time = NOW(),
              status = 'EARLY_LEAVE',
              updated_at = NOW()
          WHERE id = ${row.id}
        `);
        autoCheckoutCount++;
      } catch (err) {
        console.warn(`[cron-att-evening] 자동 퇴근 처리 실패 id=${row.id}:`, err);
      }
    }

    // 2. 재택근무자 중 보고서 미제출 알림
    const remoteNoReportRows: any = await db.execute(sql`
      SELECT r.member_uid::integer AS member_id
      FROM att_records r
      LEFT JOIN att_remote_work_reports rep
        ON rep.member_uid = r.member_uid::integer
        AND rep.date = r.date
        AND rep.status = 'SUBMITTED'
      WHERE r.date = ${today}::date
        AND r.work_mode = 'REMOTE'
        AND rep.id IS NULL
    `);
    const remoteNoReportIds: number[] = (Array.isArray(remoteNoReportRows) ? remoteNoReportRows : (remoteNoReportRows as any).rows ?? [])
      .map((r: any) => parseInt(r.member_id))
      .filter((id: number) => !isNaN(id));

    for (const memberId of remoteNoReportIds) {
      try {
        await sendWorkspaceNotification({
          memberId,
          sourceType: "event" as any,
          sourceId: 0,
          notifType: "reminder_3d" as any,
          channel: "bell" as any,
          title: "재택근무 보고서 미제출",
          body: `${today} 재택근무 일일 보고서를 아직 제출하지 않았습니다.`,
          actionUrl: "/workspace-attendance.html",
          category: "system" as any,
        });
        reportAlertCount++;
      } catch (err) {
        console.warn(`[cron-att-evening] 보고서 알림 실패 memberId=${memberId}:`, err);
      }
    }

    // 3. 주간 누적 근무시간 체크 (48시간 임박, 52시간 초과)
    const weeklyRows: any = await db.execute(sql`
      SELECT member_uid, SUM(working_mins) AS total_mins
      FROM att_records
      WHERE date >= ${weekStart}::date
        AND date <= ${today}::date
      GROUP BY member_uid
      HAVING SUM(working_mins) >= 2880
    `);
    const weeklyList = Array.isArray(weeklyRows) ? weeklyRows : (weeklyRows as any).rows ?? [];

    // 슈퍼어드민 조회 (52시간 초과 알림용)
    const superAdmins = await db
      .select({ id: members.id })
      .from(members)
      .where(and(
        eq(members.role as any, "super_admin"),
        eq(members.operatorActive as any, true),
        isNull(members.withdrawnAt),
      ))
      .limit(10);

    const over52Names: string[] = [];

    for (const row of weeklyList) {
      const memberId = parseInt(row.member_uid);
      const totalMins = parseInt(row.total_mins);
      if (isNaN(memberId) || isNaN(totalMins)) continue;

      const totalHours = Math.round(totalMins / 60 * 10) / 10;

      if (totalMins >= 3120) {
        // 52시간(3120분) 초과 → 당사자 + 슈퍼어드민 알림
        try {
          const [m] = await db.select({ name: members.name }).from(members).where(eq(members.id, memberId)).limit(1);
          const name = m?.name ?? `#${memberId}`;
          over52Names.push(`${name}(${totalHours}h)`);

          await sendWorkspaceNotification({
            memberId,
            sourceType: "event" as any,
            sourceId: 0,
            notifType: "reminder_3d" as any,
            channel: "bell" as any,
            title: "주 52시간 초과 경고",
            body: `이번 주 누적 근무 ${totalHours}시간으로 법정 한도(52h)를 초과했습니다.`,
            actionUrl: "/workspace-attendance.html",
            category: "system" as any,
          });
          overtimeAlertCount++;
        } catch (err) {
          console.warn(`[cron-att-evening] 52시간 알림 실패 memberId=${memberId}:`, err);
        }
      } else if (totalMins >= 2880) {
        // 48시간(2880분) 임박 → 당사자만
        try {
          await sendWorkspaceNotification({
            memberId,
            sourceType: "event" as any,
            sourceId: 0,
            notifType: "reminder_3d" as any,
            channel: "bell" as any,
            title: "주 52시간 임박 안내",
            body: `이번 주 누적 근무 ${totalHours}시간입니다. 법정 한도(52h)까지 ${52 - totalHours}시간 남았습니다.`,
            actionUrl: "/workspace-attendance.html",
            category: "system" as any,
          });
          overtimeAlertCount++;
        } catch (err) {
          console.warn(`[cron-att-evening] 48시간 알림 실패 memberId=${memberId}:`, err);
        }
      }
    }

    // 슈퍼어드민 52시간 초과 요약
    if (over52Names.length > 0 && superAdmins.length > 0) {
      for (const sa of superAdmins) {
        try {
          await sendWorkspaceNotification({
            memberId: sa.id,
            sourceType: "event" as any,
            sourceId: 0,
            notifType: "reminder_3d" as any,
            channel: "bell" as any,
            title: `[근태] 52시간 초과 ${over52Names.length}명`,
            body: `${over52Names.join(", ")}이(가) 주 52시간을 초과했습니다. 즉시 확인해 주세요.`,
            actionUrl: "/admin-attendance-settings.html",
            category: "system" as any,
          });
        } catch (err) {
          console.warn(`[cron-att-evening] 슈퍼어드민 52시간 알림 실패:`, err);
        }
      }
    }

    const durationMs = Date.now() - start;
    console.info(`[cron-att-evening] 완료 — 자동퇴근:${autoCheckoutCount} 보고서알림:${reportAlertCount} 초과근무알림:${overtimeAlertCount} (${durationMs}ms)`);

    return new Response(JSON.stringify({
      ok: true, autoCheckoutCount, reportAlertCount, overtimeAlertCount, durationMs,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[cron-att-evening] 오류:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message ?? err) }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
