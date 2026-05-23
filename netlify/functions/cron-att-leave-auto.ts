/**
 * cron-att-leave-auto: 유급휴가 자동 부여 (매월 1일 KST 09:00 = UTC 00:00)
 * schedule: 0 0 1 * *
 *
 * 동작:
 * 1. 전월 만근 직원 → 유급휴가 +1일 부여
 *    **만근 기준**: ABSENT + LATE(미인정) + EARLY_LEAVE(미인정) 모두 0건
 *    무단지각·무단조퇴까지 만근 기준에 포함하는 보수적 정책 (어드민이 사유 인정한
 *    is_manually_adjusted=true 케이스는 만근에서 제외하지 않음).
 *    명세 동기화: docs/milestones/2026-05-19-phase27-att-step9-17.md §6 cron-att-leave-auto.
 * 2. 입사 1년 도래 직원 → 연차 15일 일괄 부여
 * 3. 연차 소진 D-30 직원(만료 30일 이내) → 사용 촉진 알림
 */

import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members, attLeaveBalances, attLeaveTypes } from "../../db/schema";
import { eq, and, isNull, sql, gte, lte } from "drizzle-orm";
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
      })
      .from(members)
      .where(and(
        eq(members.operatorActive as any, true),
        isNull(members.withdrawnAt),
      ));
    const activeOps = activeOpsRaw.map(o => ({ ...o, uid: String(o.id) }));

    // ─── 1. 전월 만근 직원 → +1일 ───
    //   만근 조건: 결근(ABSENT) + 무단지각(LATE & is_manually_adjusted=false) +
    //              무단조퇴(EARLY_LEAVE & is_manually_adjusted=false) 모두 0건
    //   ※ is_manually_adjusted=true 는 어드민이 사유 인정한 케이스로 만근에서 제외하지 않음
    for (const op of activeOps) {
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

        if (absentCnt === 0 && lateCnt === 0 && earlyCnt === 0) {
          // 만근 → +1일 upsert
          await db.execute(sql`
            INSERT INTO att_leave_balances (member_uid, leave_type_id, year, total_days, used_days)
            VALUES (${op.uid}, ${annualLeaveType.id}, ${thisYear}, 1, 0)
            ON CONFLICT (member_uid, leave_type_id, year)
            DO UPDATE SET total_days = att_leave_balances.total_days + 1
          `);
          perfectAttendanceCount++;

          await sendWorkspaceNotification({
            memberId: op.id,
            sourceType: "event" as any,
            sourceId: 0,
            notifType: "reminder_3d" as any,
            channel: "bell" as any,
            title: "만근 보너스 연차 +1일",
            body: `${prevYear}년 ${prevMonth}월 만근으로 연차 1일이 추가되었습니다.`,
            actionUrl: "/workspace-attendance.html",
            category: "system" as any,
          });
        }
      } catch (err: any) {
        errors.push(`만근 처리 실패(${op.name}): ${err?.message}`);
      }
    }

    // ─── 2. 입사 1년 도래 직원 → 근속 기반 연차 일괄 부여 (모드 B · 5인 이상) ───
    // ★ 2026-05-23 운영 전 검수 후속: 교사유가족협의회는 5인 이하 사업장 = 모드 A(월 만근 시 +1일만
    //   운영) → 근속 기반 1주년 일괄부여는 현재 미운영. "연차 산정 정책"(모드 A/B 선택 + 모드 B의
    //   1주년 기본일수·증가일수·증가주기·상한을 슈퍼어드민이 CRUD)은 다음 라운드에서 설계·구현 예정.
    //   그때 아래 플래그를 정책 설정값으로 대체한다. (아래 +15 로직도 그때 모드 B 파라미터로 재작성)
    // R34-P2 (round3 M-G2): members 테이블에 hire_date 컬럼이 없어 회원가입일(createdAt)을
    // 입사일 대용으로 사용 — 모드 B 도입 시 hire_date 추가 마이그 + 본 cron 변경 필요.
    const SERVICE_BASED_ANNUAL_ENABLED = false;  // 모드 B 활성 시 true (정책 기능 도입 시 설정값 참조)
    for (const op of (SERVICE_BASED_ANNUAL_ENABLED ? activeOps : [])) {
      try {
        if (!op.createdAt) continue;
        const joinDate = new Date(op.createdAt);
        const joinMonth = joinDate.getMonth() + 1;
        const joinYear = joinDate.getFullYear();

        // 정확히 1년 도래 = 가입 1년 후 연도·월이 현재와 같음
        const targetYear = joinYear + 1;
        const targetMonth = joinMonth;
        if (targetYear === thisYear && targetMonth === thisMonth) {
          // ★ P1-14 fix: 기존 GREATEST(total,15)는 같은 해 적립된 만근 보너스(+1/월)를
          // 덮어써(예: 만근 3일 → 15로 고정되어 3일 손실) 잔여일이 사라졌다.
          // 1주년 연차 15일을 기존 적립분에 "더해" 부여(만근 보너스 보존).
          // (cron 월 1회 실행 + targetYear/Month 가드로 1주년 1회만 발화)
          await db.execute(sql`
            INSERT INTO att_leave_balances (member_uid, leave_type_id, year, total_days, used_days)
            VALUES (${op.uid}, ${annualLeaveType.id}, ${thisYear}, 15, 0)
            ON CONFLICT (member_uid, leave_type_id, year)
            DO UPDATE SET
              total_days = att_leave_balances.total_days + 15
          `);
          anniversaryCount++;

          await sendWorkspaceNotification({
            memberId: op.id,
            sourceType: "event" as any,
            sourceId: 0,
            notifType: "reminder_3d" as any,
            channel: "bell" as any,
            title: "입사 1주년 🎉 연차 15일 지급",
            body: `입사 1주년을 축하합니다! 연차 15일이 부여되었습니다.`,
            actionUrl: "/workspace-attendance.html",
            category: "system" as any,
          });
        }
      } catch (err: any) {
        errors.push(`연차 15일 처리 실패(${op.name}): ${err?.message}`);
      }
    }

    // ─── 3. 연차 소진 D-30 알림 ───
    // 올해 잔여 연차 < 3일이고 아직 2일 이상 있는 직원 (촉진 대상)
    // 간단하게: remaining_days > 0 AND total_days > 0이며 used_days/total_days > 0.8
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
    console.info(`[cron-att-leave-auto] 완료 — 만근:${perfectAttendanceCount} 1주년:${anniversaryCount} 촉진알림:${expiryAlertCount} (${durationMs}ms)`);

    return new Response(JSON.stringify({
      ok: true,
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
