/**
 * lib/att-utils.ts — Phase 26 근태관리 공용 유틸리티
 * B 담당자가 완성 (API 함수에서 import하여 사용)
 */
import { db } from "../db/index";
import { attSchedules, attScheduleOverrides, attPolicies } from "../db/schema";
import { eq, and, lte, or, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────
// 0. 타임존 헬퍼 (R29-ATT-GAP2)
//    Netlify 함수는 UTC 환경 → 시각 비교·판정 전 KST(+9h) 변환 필수.
//    DB 저장값은 UTC 유지 (Postgres timestamp). KST 변환은 비교·판정 시점에만.
// ─────────────────────────────────────────────────────────

/** UTC Date 를 KST 시각으로 옮긴 Date (getUTC*() 로 읽으면 KST 값) */
export const toKST = (d: Date) => new Date(d.getTime() + 9 * 3_600_000);

/** 지금(서버 UTC) → KST Date */
export const nowKST = () => toKST(new Date());

/** KST 기준 'YYYY-MM-DD' 날짜 문자열 */
export const todayKST = () => nowKST().toISOString().slice(0, 10);

/** KST 기준 'HH:MM' 시각 문자열 */
export const hhmmKST = (d?: Date) => {
  const k = d ? toKST(d) : nowKST();
  return `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
};

// ─────────────────────────────────────────────────────────
// 1. 위치 관련
// ─────────────────────────────────────────────────────────

/** Haversine 공식으로 두 GPS 좌표 간 거리(미터) 계산 */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // 지구 반지름 (미터)
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 직원이 허용 반경 이내에 있는지 여부 */
export function isWithinRadius(
  userLat: number, userLng: number,
  placeLat: number, placeLng: number,
  radiusM: number
): boolean {
  return haversineDistance(userLat, userLng, placeLat, placeLng) <= radiusM;
}

// ─────────────────────────────────────────────────────────
// 2. 근무형태 결정 (override > schedule > 기본 OFFICE)
// ─────────────────────────────────────────────────────────

export interface WorkModeResult {
  mode: string;
  workplaceId: number | null;
  recurringRule: Record<string, string> | null;
  source: "override" | "schedule" | "default";
}

export async function getScheduledWorkMode(
  memberUid: string,
  dateStr: string, // 'YYYY-MM-DD'
): Promise<WorkModeResult> {
  // 1순위: 단발성 재정의
  const override = await db
    .select()
    .from(attScheduleOverrides)
    .where(
      and(
        eq(attScheduleOverrides.memberUid, memberUid),
        eq(attScheduleOverrides.date, dateStr)
      )
    )
    .limit(1);

  if (override.length > 0) {
    return {
      mode: override[0].workMode,
      workplaceId: override[0].workplaceId ?? null,
      recurringRule: null,
      source: "override",
    };
  }

  // 2순위: 반복 스케줄 (start_date <= date AND (end_date IS NULL OR end_date >= date))
  const schedules = await db
    .select()
    .from(attSchedules)
    .where(
      and(
        eq(attSchedules.memberUid, memberUid),
        lte(attSchedules.startDate, dateStr),
        or(isNull(attSchedules.endDate), sql`${attSchedules.endDate} >= ${dateStr}`)
      )
    )
    .limit(1);

  if (schedules.length > 0) {
    const sched = schedules[0];
    let mode = sched.workMode;

    // HYBRID: recurring_rule에서 해당 요일 근무형태 조회
    //   DB 저장 규약: 키는 대문자 3자(SUN|MON|TUE|WED|THU|FRI|SAT), 값은 OFFICE|REMOTE|FIELD|BUSINESS_TRIP
    //   기존 소문자 데이터도 호환되도록 양쪽 모두 조회
    if (mode === "HYBRID" && sched.recurringRule) {
      const DAY_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
      const dayIdx = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
      const dayKeyUpper = DAY_KEYS[dayIdx];
      const dayKeyLower = dayKeyUpper.toLowerCase();
      const isWeekend = dayIdx === 0 || dayIdx === 6;

      const rule = sched.recurringRule as Record<string, string>;
      const picked = rule[dayKeyUpper] ?? rule[dayKeyLower];
      if (picked) {
        mode = picked;
      } else {
        // 미지정: 평일은 OFFICE, 주말은 HOLIDAY 로 fallback
        mode = isWeekend ? "HOLIDAY" : "OFFICE";
      }
    }

    return {
      mode,
      workplaceId: sched.workplaceId ?? null,
      recurringRule: sched.recurringRule as Record<string, string> | null,
      source: "schedule",
    };
  }

  // 기본: OFFICE
  return { mode: "OFFICE", workplaceId: null, recurringRule: null, source: "default" };
}

// ─────────────────────────────────────────────────────────
// 3. 근무시간 계산
// ─────────────────────────────────────────────────────────

export interface WorkTimeResult {
  workingMins: number;
  overtimeMins: number;
  totalMins: number;
  breakDeducted: boolean;
}

export function calcWorkingMins(
  checkIn: Date,
  checkOut: Date,
  policy: {
    dailyHours: number;
    breakMins: number;
    breakThresholdHours: number;
  }
): WorkTimeResult {
  const totalMins = Math.floor((checkOut.getTime() - checkIn.getTime()) / 60000);
  const thresholdMins = policy.breakThresholdHours * 60;
  const breakDeducted = totalMins >= thresholdMins;
  const workingMins = breakDeducted ? totalMins - policy.breakMins : totalMins;
  const standardMins = policy.dailyHours * 60;
  const overtimeMins = Math.max(0, workingMins - standardMins);
  return { workingMins: Math.max(0, workingMins), overtimeMins, totalMins, breakDeducted };
}

// ─────────────────────────────────────────────────────────
// 4. 지각·조퇴·결근 판정
// ─────────────────────────────────────────────────────────

export function determineStatus(
  checkInTime: Date | null,
  checkOutTime: Date | null,
  policy: {
    checkInTime: string;  // 'HH:MM' (정책 = KST 시각)
    checkOutTime: string; // 'HH:MM'
    lateGraceMins: number;
    earlyLeaveGraceMins: number;
  },
  isLeave: boolean,
  isHoliday: boolean
): string {
  if (isHoliday) return "HOLIDAY";
  if (isLeave) return "LEAVE";
  if (!checkInTime) return "ABSENT";

  const [ciH, ciM] = policy.checkInTime.split(":").map(Number);
  const [coH, coM] = policy.checkOutTime.split(":").map(Number);

  const stdCheckIn  = ciH * 60 + ciM + policy.lateGraceMins;
  const stdCheckOut = coH * 60 + coM - policy.earlyLeaveGraceMins;

  // R29-ATT-GAP2: 서버 TZ 의존 제거 — 입력 Date 를 KST 로 변환 후 UTC 게터로 시·분 추출
  const ckIn = toKST(checkInTime);
  const actualCheckInMins = ckIn.getUTCHours() * 60 + ckIn.getUTCMinutes();

  const isLate = actualCheckInMins > stdCheckIn;

  if (!checkOutTime) return isLate ? "LATE" : "NORMAL";

  const ckOut = toKST(checkOutTime);
  const actualCheckOutMins = ckOut.getUTCHours() * 60 + ckOut.getUTCMinutes();

  const isEarlyLeave = actualCheckOutMins < stdCheckOut;

  if (isLate && isEarlyLeave) return "LATE"; // 지각+조퇴 → 지각 우선
  if (isLate) return "LATE";
  if (isEarlyLeave) return "EARLY_LEAVE";
  return "NORMAL";
}

// ─────────────────────────────────────────────────────────
// 5. 이번 달 재택 일수 카운트
// ─────────────────────────────────────────────────────────

export async function countRemoteDaysThisMonth(
  memberUid: string,
  year: number,
  month: number, // 1~12
): Promise<number> {
  const padM = String(month).padStart(2, "0");
  const from = `${year}-${padM}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${padM}-${String(lastDay).padStart(2, "0")}`;

  const result = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM att_records
    WHERE member_uid = ${memberUid}
      AND work_mode = 'REMOTE'
      AND date >= ${from}::date
      AND date <= ${to}::date
  `);
  return Number((result.rows[0] as any)?.cnt ?? 0);
}

// ─────────────────────────────────────────────────────────
// 6. 기본 정책 조회
// ─────────────────────────────────────────────────────────

export async function getDefaultPolicy() {
  const rows = await db
    .select()
    .from(attPolicies)
    .where(eq(attPolicies.isDefault, true))
    .limit(1);
  return rows[0] ?? null;
}
