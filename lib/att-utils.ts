/**
 * lib/att-utils.ts — Phase 26 근태관리 공용 유틸리티
 * B 담당자가 완성 (API 함수에서 import하여 사용)
 */
import { db } from "../db/index";
import { attSchedules, attScheduleOverrides, attPolicies } from "../db/schema";
import { eq, and, lte, or, isNull, desc } from "drizzle-orm";
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
    .orderBy(desc(attSchedules.startDate))
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

/**
 * 유연근무 출근 하한(floor) UTC Date 계산.
 *   floor = 표준출근(checkInTime HH:MM, KST) − flexRangeMins
 *   예) 09:00 − 60분 = 08:00. 이 시각보다 이른 출근은 근무시간에 산입하지 않음(근무·야근 계산용).
 *   표시용 출근시각(실제 도착)은 그대로 두고, 근무분 계산에만 사용.
 *   firstIn(출근 UTC)의 KST 날짜에 floor 시각을 세팅해 UTC Date로 반환.
 */
export function flexStartFloor(firstIn: Date, checkInTimeHHMM: string, flexRangeMins: number): Date {
  const kst = toKST(firstIn);
  const parts = String(checkInTimeHHMM).split(":");
  const ciH = Number(parts[0]) || 0;
  const ciM = Number(parts[1]) || 0;
  const floorMin = ciH * 60 + ciM - (Number(flexRangeMins) || 0);
  const floorShiftedMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 0, 0, 0) + floorMin * 60_000;
  return new Date(floorShiftedMs - 9 * 3_600_000);
}

/**
 * 재실시간(출근~퇴근)에 따라 차감할 휴게시간(분).
 *
 * 2026-07-12 개정 — 근로기준법 제54조에 맞춰 단계화:
 *   · 소정근로(8시간) 이상  → 설정값 (기본 60분)
 *   · 4시간 초과 ~ 8시간 미만 → 30분 (법정 최소)
 *   · 4시간 이하             → 0분   (반차 4시간 연속근무 — 휴게를 빼지 않는다)
 *
 * 과거엔 "4시간만 넘으면 무조건 60분"이라, 반차(4시간)를 쓴 날의 근무시간이
 * 3시간으로 기록돼 실제보다 1시간 짧게 남았다. 급여를 근무시간으로 산정하게 되면서
 * 이 오차가 그대로 지급액 오류로 이어지므로 바로잡는다.
 */
export function breakMinsFor(
  totalMins: number,
  policy: { dailyHours: number; breakMins: number; breakThresholdHours: number }
): number {
  const fullMins = Number(policy.dailyHours) * 60;            // 8시간
  const halfMins = Number(policy.breakThresholdHours) * 60;   // 4시간
  const full = Number(policy.breakMins) || 0;
  if (totalMins >= fullMins) return full;                     // 8시간 이상 → 설정값(60분)
  if (totalMins > halfMins) return Math.min(full, 30);        // 4시간 초과 ~ 8시간 미만 → 30분
  return 0;                                                   // 4시간 이하 → 휴게 차감 없음
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
  const deduct = breakMinsFor(totalMins, policy);
  const workingMins = totalMins - deduct;
  const standardMins = policy.dailyHours * 60;
  const overtimeMins = Math.max(0, workingMins - standardMins);
  return { workingMins: Math.max(0, workingMins), overtimeMins, totalMins, breakDeducted: deduct > 0 };
}

/**
 * 지급일수 구간 판정의 유예(분).
 *
 * 왜 필요한가: 유예가 없으면 근무시간이 1분 모자란 것만으로 지급이 25% 깎인다.
 *   (실제 사례: 08:00~17:00 근무가 초 단위 때문에 7시간 59분으로 기록 → 0.75일치로 추락)
 *   출퇴근 버튼을 누르는 시각은 몇 분 흔들릴 수밖에 없으므로, 각 구간 경계에 유예를 둔다.
 */
export const PAY_DAY_GRACE_MINS = 10;

/**
 * 그날 급여 지급 대상 일수 — 실제 근무시간을 소정근로시간 대비 0.25일 단위로 환산.
 *
 * Swain 정책(2026-07-12): 일급제라도 반차·반반차를 쓴 날은 일한 만큼만 지급한다.
 *   8시간 이상        → 1.00일
 *   6시간 이상 8시간 미만 → 0.75일   (반반차 수준)
 *   4시간 이상 6시간 미만 → 0.50일   (반차 수준)
 *   2시간 이상 4시간 미만 → 0.25일
 *   2시간 미만        → 0
 * 각 경계는 위 유예(기본 10분)만큼 너그럽게 본다.
 *
 * 휴가 신청 여부와 무관하게 '실제 일한 시간'으로 정하므로,
 * 반차를 신청하지 않고 일찍 퇴근해도 급여가 정확히 맞는다.
 * (퇴근을 안 찍어 근무시간을 모르는 날은 호출부에서 별도 처리 — 여기선 0)
 */
export function payDayFraction(
  workingMins: number | null | undefined,
  dailyHours = 8,
  graceMins: number = PAY_DAY_GRACE_MINS,
): number {
  const std = Number(dailyHours) * 60;
  const mins = Number(workingMins);
  if (!Number.isFinite(mins) || mins <= 0 || std <= 0) return 0;
  const g = Math.max(0, Number(graceMins) || 0);
  if (mins >= std - g)        return 1;
  if (mins >= std * 0.75 - g) return 0.75;
  if (mins >= std * 0.5 - g)  return 0.5;
  if (mins >= std * 0.25 - g) return 0.25;
  return 0;
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
    coreStartTime?: string | null;  // R34-P2: REMOTE LATE 기준 (코어타임 시작)
    coreEndTime?:   string | null;
    flexEnabled?: boolean;       // 유연출퇴근제 ON (2026-05-26)
    flexRangeMins?: number;      // 출근 ±X 자율 허용범위(분) — flexEnabled 시 lateGrace 대체
  },
  isLeave: boolean,
  isHoliday: boolean,
  workMode?: string,  // R34-P2 (round3 M-G7): REMOTE는 코어타임 기준으로 LATE 판정
): string {
  if (isHoliday) return "HOLIDAY";
  if (isLeave) return "LEAVE";
  if (!checkInTime) return "ABSENT";

  // R34-P2 (M-G7): REMOTE·BUSINESS_TRIP은 코어타임 시작 기준 LATE 판정 (자율 출근 정책)
  //   coreStartTime 정책 미설정 시 fallback으로 표준 출근시각 적용
  const useCoreTime = (workMode === "REMOTE" || workMode === "BUSINESS_TRIP") && policy.coreStartTime;
  const checkInRef = useCoreTime ? (policy.coreStartTime as string) : policy.checkInTime;

  const [ciH, ciM] = checkInRef.split(":").map(Number);
  const [coH, coM] = policy.checkOutTime.split(":").map(Number);

  // 유연출퇴근제(2026-05-26): ON이면 출근 허용범위가 ±flexRangeMins(고정 lateGrace 대체),
  //   조퇴(시각 기준)는 판정 안 함 — '8시간 근무 미달'은 퇴근 시 별도 경고가 담당.
  const flexOn = !!policy.flexEnabled && policy.flexRangeMins != null;
  const ciBase = ciH * 60 + ciM;
  const lateThreshold = ciBase + (flexOn ? (policy.flexRangeMins as number) : policy.lateGraceMins);
  const stdCheckOut = coH * 60 + coM - policy.earlyLeaveGraceMins;

  // R29-ATT-GAP2: 서버 TZ 의존 제거 — 입력 Date 를 KST 로 변환 후 UTC 게터로 시·분 추출
  const ckIn = toKST(checkInTime);
  const actualCheckInMins = ckIn.getUTCHours() * 60 + ckIn.getUTCMinutes();

  const isLate = actualCheckInMins > lateThreshold;

  if (!checkOutTime) return isLate ? "LATE" : "NORMAL";

  const ckOut = toKST(checkOutTime);
  const actualCheckOutMins = ckOut.getUTCHours() * 60 + ckOut.getUTCMinutes();

  const isEarlyLeave = flexOn ? false : (actualCheckOutMins < stdCheckOut);

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
  return Number(((result as any).rows?.[0])?.cnt ?? 0);
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

/**
 * 유연 허용범위(분) 조회 — flex_range_mins 컬럼은 schema 정의 밖(raw SQL 격리·billing_keys 패턴).
 * migrate-att-flex-range 적용 전이면 컬럼 없음 → catch로 기본 120(±2시간) 반환(배포 안전).
 */
export async function getFlexRangeMins(): Promise<number> {
  try {
    const r: any = await db.execute(
      sql`SELECT flex_range_mins FROM att_policies WHERE is_default = true LIMIT 1`
    );
    const rows: any[] = r?.rows ?? r ?? [];
    const v = rows[0]?.flex_range_mins;
    return v == null ? 120 : Number(v);
  } catch {
    return 120;
  }
}
