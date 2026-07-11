/**
 * cron-att-evening: 야간 정리 cron (KST 자정 = UTC 15:00)
 * schedule: 0 15 * * *
 *
 * Phase 27 §6 명세 갱신 (R29-ATT-GAP2 정책 변경, 2026-05-19): 미퇴근 자동 처리 폐지·통보만.
 *
 * 동작 (R29-ATT-GAP2: 강제 퇴근 제거):
 * 1. 오늘 출근 기록은 있으나 퇴근 null 인 직원 — 명단을 슈퍼어드민에게 통보 (강제 변경 X)
 *    현장직·야간직 부당 처리 방지: DB 변경 없이 운영자가 사후 판정.
 * 2. 재택근무자 중 보고서 미제출 직원 → 본인 인앱 알림
 * 3. 주간 누적 48시간 임박 직원 → 임박 알림
 * 4. 주간 누적 52시간 초과 직원 → 슈퍼어드민 즉시 알림
 *
 * 디버그/검증 모드: 어떤 URL이든 ?dryRun=1 → DB 변경·알림 발송 없이 탐지 명단만 JSON 반환
 */

import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members, attRecords, attRemoteWorkReports } from "../../db/schema";
import { eq, and, isNull, inArray, isNotNull, sql } from "drizzle-orm";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";
import { reportDeadline } from "../../lib/att-remote-policy";

export const config = { schedule: "0 15 * * *" };

// 이 크론은 KST 00:00(자정)에 실행되므로 '방금 끝난 전일'을 대상으로 조회한다.
// (P1-16 fix: 과거엔 '새로 시작된 당일'을 조회해 미퇴근·재택보고서·주52h 점검이 항상 0건이었음.
//  스케줄을 저녁 시간대로 옮기려면 이 전일 기준도 함께 재검토할 것.)
function kstYesterday(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() - 1);
  return kst.toISOString().slice(0, 10);
}

function kstWeekStartOf(dateStr: string): string {
  // dateStr(YYYY-MM-DD, KST)이 속한 주의 월요일 — 전일 기준이라 방금 완결된 주를 평가.
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay(); // 0=일,1=월,...
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export default async (req: Request, _ctx: Context) => {
  const start = Date.now();
  const today = kstYesterday();          // 대상일 = 전일(방금 끝난 날)
  const weekStart = kstWeekStartOf(today);

  // ?dryRun=1 : DB 변경·알림 발송 없이 탐지 결과만 반환 (운영자 검증용)
  let dryRun = false;
  try {
    const u = new URL(req.url);
    dryRun = u.searchParams.get("dryRun") === "1";
  } catch {}
  console.info("[cron-att-evening] 시작", today, dryRun ? "(dryRun)" : "");

  let reportAlertCount = 0;
  let overtimeAlertCount = 0;

  try {
    // 1. 미퇴근자 명단 수집 (R29-ATT-GAP2: 강제 퇴근 처리 제거)
    //    슈퍼어드민에게 명단만 통보 → 운영자가 사후 판정.
    const noCheckoutRows: any = await db.execute(sql`
      SELECT r.id, r.member_uid, r.check_in_time, r.work_mode, m.name
      FROM att_records r
      LEFT JOIN members m ON m.id = r.member_uid::integer
      WHERE r.date = ${today}::date
        AND r.check_in_time IS NOT NULL
        AND r.check_out_time IS NULL
    `);
    const noCheckoutList: any[] = Array.isArray(noCheckoutRows) ? noCheckoutRows : (noCheckoutRows as any).rows ?? [];
    const missingNames = noCheckoutList.map(r => r.name ?? `#${r.member_uid}`);

    // 2. 재택근무자 중 보고서 미제출 알림
    //    R29-ATT-GAP1 이후 att_remote_work_reports.member_uid 는 varchar — 캐스트 불필요
    const remoteNoReportRows: any = await db.execute(sql`
      SELECT r.member_uid::integer AS member_id
      FROM att_records r
      LEFT JOIN att_remote_work_reports rep
        ON rep.member_uid = r.member_uid
        AND rep.date = r.date
        AND rep.status IN ('SUBMITTED', 'EXEMPTED')
      WHERE r.date = ${today}::date
        AND r.work_mode = 'REMOTE'
        AND rep.id IS NULL
    `);
    const remoteNoReportIds: number[] = (Array.isArray(remoteNoReportRows) ? remoteNoReportRows : (remoteNoReportRows as any).rows ?? [])
      .map((r: any) => parseInt(r.member_id))
      .filter((id: number) => !isNaN(id));

    if (!dryRun) {
      for (const memberId of remoteNoReportIds) {
        try {
          await sendWorkspaceNotification({
            memberId,
            sourceType: "event" as any,
            sourceId: 0,
            notifType: "reminder_3d" as any,
            channel: "bell" as any,
            title: "재택근무 보고서 미제출",
            body: `${today} 재택근무 일일 보고서를 아직 제출하지 않았습니다. ` +
              `${reportDeadline(today)} 자정까지 제출하지 않으면 그 날은 근무로 인정되지 않습니다 (급여 산정 제외).`,
            actionUrl: "/workspace-attendance.html",
            category: "system" as any,
          });
          reportAlertCount++;
        } catch (err) {
          console.warn(`[cron-att-evening] 보고서 알림 실패 memberId=${memberId}:`, err);
        }
      }
    }

    // 3. 주간 누적 근무시간 체크 (48시간 임박, 52시간 초과)
    // Q3-043 fix: 미퇴근일(check_in 있으나 working_mins NULL)을 8h(480분) 추정으로 보정 — 52h 경고 누락 방지.
    //   (경고용 추정치이며 급여 계산과 무관. 휴가·결근 등 check_in 없는 날은 0.)
    const weeklyRows: any = await db.execute(sql`
      SELECT member_uid,
             SUM(CASE WHEN check_in_time IS NOT NULL THEN COALESCE(working_mins, 480) ELSE 0 END) AS total_mins
      FROM att_records
      WHERE date >= ${weekStart}::date
        AND date <= ${today}::date
      GROUP BY member_uid
      HAVING SUM(CASE WHEN check_in_time IS NOT NULL THEN COALESCE(working_mins, 480) ELSE 0 END) >= 2880
    `);
    const weeklyList = Array.isArray(weeklyRows) ? weeklyRows : (weeklyRows as any).rows ?? [];

    // 슈퍼어드민 조회 (미퇴근 명단·52시간 초과 알림 공통)
    const superAdmins = await db
      .select({ id: members.id })
      .from(members)
      .where(and(
        eq(members.role as any, "super_admin"),
        eq(members.operatorActive as any, true),
        isNull(members.withdrawnAt),
      ))
      .limit(10);

    // 1-b. 미퇴근자 슈퍼어드민 통보 (강제 처리 대신 명단 알림만)
    let missingCheckoutAlertCount = 0;
    if (!dryRun && missingNames.length > 0 && superAdmins.length > 0) {
      for (const sa of superAdmins) {
        try {
          await sendWorkspaceNotification({
            memberId: sa.id,
            sourceType: "event" as any,
            sourceId: 0,
            notifType: "reminder_3d" as any,
            channel: "bell" as any,
            title: `전일 미퇴근자 ${missingNames.length}명`,
            body: `${today} 미퇴근: ${missingNames.slice(0, 10).join(", ")}${missingNames.length > 10 ? ` 외 ${missingNames.length - 10}명` : ""}`,
            // R34-P2 (round2 M10): 미퇴근 → 근태 현황 탭
            actionUrl: "/cms-tbfa.html#att-ops",
            category: "system" as any,
          });
          missingCheckoutAlertCount++;
        } catch (err) {
          console.warn(`[cron-att-evening] 미퇴근 슈퍼어드민 알림 실패:`, err);
        }
      }
    }

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

          if (dryRun) continue;
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
          if (dryRun) continue;
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
    if (!dryRun && over52Names.length > 0 && superAdmins.length > 0) {
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
            // R34-P2 (round2 M10): 52h 초과 → 근태 현황 탭
            actionUrl: "/cms-tbfa.html#att-ops",
            category: "system" as any,
          });
        } catch (err) {
          console.warn(`[cron-att-evening] 슈퍼어드민 52시간 알림 실패:`, err);
        }
      }
    }

    const durationMs = Date.now() - start;
    console.info(`[cron-att-evening] 완료 — 미퇴근:${missingNames.length}명 보고서알림:${reportAlertCount} 초과근무알림:${overtimeAlertCount} (${durationMs}ms)${dryRun ? " [dryRun]" : ""}`);

    return new Response(JSON.stringify({
      ok: true,
      dryRun,
      missingCheckout: { count: missingNames.length, names: missingNames, alertSent: missingCheckoutAlertCount },
      reportAlertCount,
      overtimeAlertCount,
      over52Names,
      durationMs,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[cron-att-evening] 오류:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message ?? err) }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
