/**
 * cron-att-leave-auto: 유급휴가 자동 부여 (매월 1일 KST 09:00 = UTC 00:00)
 * schedule: 0 0 1 * *
 *
 * 연차 산정 정책(att_policies 기본행 is_default=true)에 따라 모드 분기:
 *  - 모드 A (5인 이하): 전월 만근 직원 → +perfect_bonus_per_month 일 (기본 1일)
 *       만근 기준: ABSENT + 무단 LATE + 무단 EARLY_LEAVE 모두 0건
 *       (is_manually_adjusted=true 인정 케이스는 만근에서 제외하지 않음).
 *  - 모드 B (5인 이상): 입사 N주년 도래(입사월=당월·1주년 이상) 직원 → 근속 기반 연차 부여
 *       days = annual_base_days + floor((근속년수-1)/annual_increment_years)*annual_increment_days
 *       (상한 annual_cap_days). 입사일 = members.hire_date ?? createdAt(가입일 폴백).
 *       예) base12·inc1·incYears2 → 1주년 12 / 3년차 13 / 5년차 14.
 *  - 공통: 연차 소진 D-30 사용 촉진 알림 (모드 무관).
 *
 * 정책 설정 UI: /api/admin-att-leave-policy (슈퍼어드민). 정책 부재 시 기본값(모드 A).
 */

import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members, attLeaveBalances, attLeaveTypes, attPolicies } from "../../db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

export const config = { schedule: "0 0 1 * *" };

function kstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

export default async (_req: Request, _ctx: Context) => {
  const start = Date.now();
  const now = kstNow();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1; // 1~12

  // 전월 계산
  const prevMonth = thisMonth === 1 ? 12 : thisMonth - 1;
  const prevYear = thisMonth === 1 ? thisYear - 1 : thisYear;
  const prevMonthStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
  const prevMonthLastDay = new Date(prevYear, prevMonth, 0).getDate();
  const prevMonthEnd = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(prevMonthLastDay).padStart(2, "0")}`;

  console.info(`[cron-att-leave-auto] 시작 — 대상 전월: ${prevMonthStart}~${prevMonthEnd}`);

  let perfectAttendanceCount = 0;
  let anniversaryCount = 0;
  let expiryAlertCount = 0;
  const errors: string[] = [];

  try {
    // ─── 연차 산정 정책 로드 (is_default=true 기본행·부재 시 기본값 모드 A) ───
    const policy = {
      mode: "A" as "A" | "B",
      baseDays: 12,
      incDays: 1,
      incYears: 2,
      capDays: 25,
      perfectBonus: 1,
    };
    try {
      const prow = await db.select().from(attPolicies)
        .where(eq(attPolicies.isDefault, true)).limit(1);
      if (prow[0]) {
        policy.mode         = prow[0].leaveAccrualMode === "B" ? "B" : "A";
        policy.baseDays     = Number(prow[0].annualBaseDays);
        policy.incDays      = Number(prow[0].annualIncrementDays);
        policy.incYears     = Math.max(1, Number(prow[0].annualIncrementYears));
        policy.capDays      = Number(prow[0].annualCapDays);
        policy.perfectBonus = Number(prow[0].perfectBonusPerMonth);
      }
    } catch (err: any) {
      console.warn("[cron-att-leave-auto] 정책 로드 실패 — 기본값(모드 A) 사용:", err?.message);
    }
    console.info(`[cron-att-leave-auto] 정책 모드=${policy.mode} base=${policy.baseDays} inc=${policy.incDays}/${policy.incYears}y cap=${policy.capDays} bonus=${policy.perfectBonus}`);

    // "연차" 휴가 타입 조회 (is_paid=true, 이름에 "연차" 포함 우선)
    const leaveTypes = await db
      .select({ id: attLeaveTypes.id, name: attLeaveTypes.name })
      .from(attLeaveTypes)
      .where(and(
        eq(attLeaveTypes.isActive, true),
        eq(attLeaveTypes.isPaid, true),
      ))
      .orderBy(attLeaveTypes.displayOrder)
      .limit(10);

    const annualLeaveType = leaveTypes.find(t => t.name.includes("연차")) ?? leaveTypes[0];
    if (!annualLeaveType) {
      console.warn("[cron-att-leave-auto] 연차 휴가 타입 없음 — 종료");
      return new Response(JSON.stringify({ ok: true, message: "연차 타입 없음" }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // 활성 운영자 목록 (att_*.member_uid 는 members.id 문자열)
    const activeOpsRaw = await db
      .select({
        id: members.id,
        name: members.name,
        createdAt: members.createdAt,
        hireDate: members.hireDate,
      })
      .from(members)
      .where(and(
        eq(members.operatorActive as any, true),
        isNull(members.withdrawnAt),
      ));
    const activeOps = activeOpsRaw.map(o => ({ ...o, uid: String(o.id) }));

    // ─── 1. [모드 A] 전월 만근 직원 → +perfect_bonus 일 ───
    //   만근 조건: 결근(ABSENT) + 무단지각(LATE & is_manually_adjusted=false) +
    //              무단조퇴(EARLY_LEAVE & is_manually_adjusted=false) 모두 0건
    for (const op of (policy.mode === "A" ? activeOps : [])) {
      try {
        const violationRows: any = await db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE status = 'ABSENT')                                  AS absent_cnt,
            COUNT(*) FILTER (WHERE status = 'LATE'        AND is_manually_adjusted = false) AS late_cnt,
            COUNT(*) FILTER (WHERE status = 'EARLY_LEAVE' AND is_manually_adjusted = false) AS early_cnt
          FROM att_records
          WHERE member_uid = ${op.uid}
            AND date >= ${prevMonthStart}::date
            AND date <= ${prevMonthEnd}::date
        `);
        const v = (Array.isArray(violationRows) ? violationRows[0] : ((violationRows as any).rows ?? [])[0]) ?? {};
        const absentCnt = Number(v.absent_cnt ?? 0);
        const lateCnt   = Number(v.late_cnt ?? 0);
        const earlyCnt  = Number(v.early_cnt ?? 0);

        // P2-16 fix (Swain 결정 2026-07-10): 만근 = 위반 0건 + 그달 영업일(주말·공휴일 제외) 전부 출근/승인휴가 기록.
        //   (과거: 결근이 자동기록 안 돼 무출근·장기결근도 위반 0 → 만근으로 보너스 연차 오지급)
        const bizRows: any = await db.execute(sql`
          SELECT
            (SELECT COUNT(*) FROM generate_series(${prevMonthStart}::date, ${prevMonthEnd}::date, interval '1 day') d
              WHERE EXTRACT(DOW FROM d) NOT IN (0,6)
                AND d::date NOT IN (SELECT date FROM att_holidays WHERE date BETWEEN ${prevMonthStart}::date AND ${prevMonthEnd}::date)) AS biz_days,
            (SELECT COUNT(DISTINCT date) FROM att_records
              WHERE member_uid = ${op.uid} AND date >= ${prevMonthStart}::date AND date <= ${prevMonthEnd}::date
                AND status IN ('NORMAL','LATE','EARLY_LEAVE','PARTIAL_LEAVE','LEAVE','HOLIDAY')) AS recorded_days
        `);
        const bz = (Array.isArray(bizRows) ? bizRows[0] : ((bizRows as any).rows ?? [])[0]) ?? {};
        const fullyPresent = Number(bz.biz_days ?? 0) > 0 && Number(bz.recorded_days ?? 0) >= Number(bz.biz_days ?? 0);

        if (absentCnt === 0 && lateCnt === 0 && earlyCnt === 0 && fullyPresent && policy.perfectBonus > 0) {
          // 만근 → +perfectBonus 일 upsert
          await db.execute(sql`
            INSERT INTO att_leave_balances (member_uid, leave_type_id, year, total_days, used_days)
            VALUES (${op.uid}, ${annualLeaveType.id}, ${thisYear}, ${policy.perfectBonus}, 0)
            ON CONFLICT (member_uid, leave_type_id, year)
            DO UPDATE SET total_days = att_leave_balances.total_days + ${policy.perfectBonus}
          `);
          perfectAttendanceCount++;

          await sendWorkspaceNotification({
            memberId: op.id,
            sourceType: "event" as any,
            sourceId: 0,
            notifType: "reminder_3d" as any,
            channel: "bell" as any,
            title: `만근 보너스 연차 +${policy.perfectBonus}일`,
            body: `${prevYear}년 ${prevMonth}월 만근으로 연차 ${policy.perfectBonus}일이 추가되었습니다.`,
            actionUrl: "/workspace-attendance.html",
            category: "system" as any,
          });
        }
      } catch (err: any) {
        errors.push(`만근 처리 실패(${op.name}): ${err?.message}`);
      }
    }

    // ─── 2. [모드 B] 입사 N주년 도래 직원 → 근속 기반 연차 부여 ───
    //   입사월 == 당월 && 1주년 이상. 입사일 = hire_date ?? createdAt(가입일 폴백).
    //   days = base + floor((근속년수-1)/incYears)*incDays, 상한 cap.
    //   ON CONFLICT 시 GREATEST 로 기존 잔여 보존(P1-14: 적립분 손실 방지).
    for (const op of (policy.mode === "B" ? activeOps : [])) {
      try {
        const hireRaw = op.hireDate ?? op.createdAt;
        if (!hireRaw) continue;
        const hire = new Date(hireRaw as any);
        if (isNaN(hire.getTime())) continue;
        const hireMonth = hire.getMonth() + 1;
        const hireYear = hire.getFullYear();

        // 입사월 == 당월 && 최소 1주년 도래
        if (hireMonth === thisMonth && thisYear > hireYear) {
          const serviceYears = thisYear - hireYear; // 근속 만 N년
          let days = policy.baseDays + Math.floor((serviceYears - 1) / policy.incYears) * policy.incDays;
          days = Math.min(days, policy.capDays);
          if (days <= 0) continue;

          await db.execute(sql`
            INSERT INTO att_leave_balances (member_uid, leave_type_id, year, total_days, used_days)
            VALUES (${op.uid}, ${annualLeaveType.id}, ${thisYear}, ${days}, 0)
            ON CONFLICT (member_uid, leave_type_id, year)
            DO UPDATE SET total_days = GREATEST(att_leave_balances.total_days, ${days})
          `);
          anniversaryCount++;

          await sendWorkspaceNotification({
            memberId: op.id,
            sourceType: "event" as any,
            sourceId: 0,
            notifType: "reminder_3d" as any,
            channel: "bell" as any,
            title: `입사 ${serviceYears}주년 🎉 연차 ${days}일`,
            body: `입사 ${serviceYears}주년을 축하합니다! 근속 연차 ${days}일이 부여되었습니다.`,
            actionUrl: "/workspace-attendance.html",
            category: "system" as any,
          });
        }
      } catch (err: any) {
        errors.push(`근속 연차 처리 실패(${op.name}): ${err?.message}`);
      }
    }

    // ─── 3. [공통] 연차 소진 D-30 알림 ───
    // 올해 잔여 연차가 총 휴가의 20% 이하로 떨어진 직원 (촉진 대상)
    for (const op of activeOps) {
      try {
        const balRows: any = await db.execute(sql`
          SELECT total_days, used_days, (total_days - used_days) AS remaining
          FROM att_leave_balances
          WHERE member_uid = ${op.uid}
            AND leave_type_id = ${annualLeaveType.id}
            AND year = ${thisYear}
        `);
        const bal = (Array.isArray(balRows) ? balRows[0] : ((balRows as any).rows ?? [])[0]);
        if (!bal) continue;

        const remaining = parseFloat(bal.remaining ?? "0");
        const total = parseFloat(bal.total_days ?? "0");

        // 잔여 1일 이상 있으면서 총 휴가 중 80% 이상 사용한 경우
        if (remaining >= 1 && total > 0 && remaining / total <= 0.2) {
          await sendWorkspaceNotification({
            memberId: op.id,
            sourceType: "event" as any,
            sourceId: 0,
            notifType: "reminder_3d" as any,
            channel: "bell" as any,
            title: "연차 사용 촉진 안내",
            body: `올해 연차 잔여 ${remaining}일입니다. 연말 전에 사용해 주세요.`,
            actionUrl: "/workspace-attendance.html",
            category: "system" as any,
          });
          expiryAlertCount++;
        }
      } catch (err: any) {
        errors.push(`연차 촉진 알림 실패(${op.name}): ${err?.message}`);
      }
    }

    const durationMs = Date.now() - start;
    console.info(`[cron-att-leave-auto] 완료 — 모드:${policy.mode} 만근:${perfectAttendanceCount} 근속:${anniversaryCount} 촉진알림:${expiryAlertCount} (${durationMs}ms)`);

    return new Response(JSON.stringify({
      ok: true,
      mode: policy.mode,
      perfectAttendanceCount,
      anniversaryCount,
      expiryAlertCount,
      errors: errors.slice(0, 10),
      durationMs,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[cron-att-leave-auto] 오류:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message ?? err) }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
