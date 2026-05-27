import { db } from "../../db/index";
import { attRecords } from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { todayKST, getDefaultPolicy } from "../../lib/att-utils";

export const config = { path: "/api/att-my-status" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "본인 상태 조회 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;

  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const memberUid: string = String(auth.ctx.member.id);

  const today = todayKST();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const padM = String(month).padStart(2, "0");
  const monthStart = `${year}-${padM}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${padM}-${String(lastDay).padStart(2, "0")}`;

  // 오늘 출퇴근 기록
  let todayRecord: any = null;
  try {
    const rows = await db
      .select()
      .from(attRecords)
      .where(and(eq(attRecords.memberUid, memberUid), eq(attRecords.date, today)))
      .limit(1);
    todayRecord = rows[0] ?? null;
  } catch (err) {
    console.warn("[att-my-status] 오늘 기록 조회 실패:", err);
  }

  // 이번달 요약
  let monthlySummary = {
    workDays: 0,
    totalWorkingMins: 0,
    lateCount: 0,
    remoteDays: 0,
  };
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('NORMAL','LATE','EARLY_LEAVE','PARTIAL_LEAVE') AND check_in_time IS NOT NULL) AS work_days,  -- Q3-025: 실출근일만
        COALESCE(SUM(working_mins), 0)                           AS total_working_mins,
        COUNT(*) FILTER (WHERE status = 'LATE')                  AS late_count,
        COUNT(*) FILTER (WHERE work_mode = 'REMOTE')             AS remote_days
      FROM att_records
      WHERE member_uid = ${memberUid}
        AND date >= ${monthStart}::date
        AND date <= ${monthEnd}::date
    `);
    const row = ((result as any).rows?.[0] ?? (result as any[])[0]) as any;
    if (row) {
      monthlySummary = {
        workDays:         Number(row.work_days),
        totalWorkingMins: Number(row.total_working_mins),
        lateCount:        Number(row.late_count),
        remoteDays:       Number(row.remote_days),
      };
    }
  } catch (err) {
    console.warn("[att-my-status] 월 요약 조회 실패:", err);
  }

  // 잔여 연차 (연차: leave_type 중 첫 번째 활성 유급 휴가 기준)
  let annualLeaveBalance: any = null;
  try {
    const rows = await db.execute(sql`
      SELECT
        b.total_days,
        b.used_days,
        (b.total_days - b.used_days) AS remaining_days,
        lt.name
      FROM att_leave_balances b
      JOIN att_leave_types lt ON lt.id = b.leave_type_id
      WHERE b.member_uid = ${memberUid}
        AND b.year = ${year}
        AND lt.is_paid = true
        AND lt.is_active = true
      ORDER BY lt.display_order, lt.id
      LIMIT 1
    `);
    annualLeaveBalance = ((rows as any).rows?.[0] as any) ?? null;
  } catch (err) {
    console.warn("[att-my-status] 잔여 연차 조회 실패:", err);
  }

  // R35-GAP-P2 M-G4: 직원 정책 안내용 요약 (코어타임·지각 허용 등)
  let policySummary: any = null;
  try {
    const policy = await getDefaultPolicy();
    if (policy) {
      policySummary = {
        checkInTime:        String(policy.checkInTime),
        checkOutTime:       String(policy.checkOutTime),
        lateGraceMins:      policy.lateGraceMins,
        earlyLeaveGraceMins: policy.earlyLeaveGraceMins,
        coreStartTime:      policy.coreStartTime ? String(policy.coreStartTime) : null,
        coreEndTime:        policy.coreEndTime   ? String(policy.coreEndTime)   : null,
        remoteMaxPerMonth:  policy.remoteMaxPerMonth,
        dailyHours:         policy.dailyHours,
      };
    }
  } catch (err) {
    console.warn("[att-my-status] 정책 조회 실패:", err);
  }

  return jsonOk({
    memberUid,
    today: todayRecord,
    monthly: monthlySummary,
    annualLeave: annualLeaveBalance,
    policy: policySummary,
  });
}
