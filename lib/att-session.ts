// lib/att-session.ts
// 출퇴근 다중 세션 헬퍼 — att-checkin · att-checkout · att-session-edit 공용.
// 요약 컬럼(check_in_time=첫 출근·check_out_time=마지막 퇴근·working_mins=합계)을
// 세션 배열로부터 재계산해 기존 통계·급여·현황과의 호환을 유지한다.
import { calcWorkingMins } from "./att-utils";

export interface AttSession {
  in: string;                 // ISO 문자열 (출근)
  out: string | null;         // ISO 문자열 | null (퇴근·null이면 진행 중)
  inLat?: string | null;
  inLng?: string | null;
  outLat?: string | null;
  outLng?: string | null;
  workplaceId?: number | null;
}

/** record.sessions 정규화 — 비어 있고 check_in_time 이 있으면 단일 세션으로 유추(구버전 행 호환). */
export function normalizeSessions(rec: any): AttSession[] {
  const arr: AttSession[] = Array.isArray(rec?.sessions) ? rec.sessions.slice() : [];
  if (arr.length === 0 && rec?.checkInTime) {
    arr.push({
      in: new Date(rec.checkInTime).toISOString(),
      out: rec.checkOutTime ? new Date(rec.checkOutTime).toISOString() : null,
      inLat: rec.checkInLat ?? null, inLng: rec.checkInLng ?? null,
      outLat: rec.checkOutLat ?? null, outLng: rec.checkOutLng ?? null,
      workplaceId: rec.workplaceId ?? null,
    });
  }
  return arr;
}

export function lastSession(sessions: AttSession[]): AttSession | null {
  return sessions.length ? sessions[sessions.length - 1] : null;
}

/** 마지막 세션이 미완료(out 없음) = 현재 근무 중. */
export function isWorking(sessions: AttSession[]): boolean {
  const last = lastSession(sessions);
  return !!(last && last.in && !last.out);
}

export interface PolicyLike {
  dailyHours: any;
  breakMins: number;
  breakThresholdHours: any;
}

/**
 * 세션 배열에서 요약 재계산 (모든 세션 완료 전제 — 퇴근 직후 호출).
 *  - 단일 세션: 기존 calcWorkingMins(휴게 차감) 그대로
 *  - 다중 세션: 세션 사이를 휴게로 보고 각 (out-in) 합산(추가 휴게 차감 없음)
 */
export function recomputeSummary(
  sessions: AttSession[],
  policy: PolicyLike
): { checkInTime: Date | null; checkOutTime: Date | null; workingMins: number | null; overtimeMins: number } {
  const valid = sessions.filter(s => s.in);
  if (valid.length === 0) return { checkInTime: null, checkOutTime: null, workingMins: null, overtimeMins: 0 };

  const firstIn = new Date(valid[0].in);
  const completed = valid.filter(s => s.out);
  const working = !valid[valid.length - 1].out;

  // 진행 중(마지막 세션 미완료) — 퇴근 미확정
  if (working || completed.length === 0) {
    return { checkInTime: firstIn, checkOutTime: null, workingMins: null, overtimeMins: 0 };
  }

  const lastOut = new Date(completed[completed.length - 1].out as string);

  if (completed.length === 1) {
    const { workingMins, overtimeMins } = calcWorkingMins(
      new Date(completed[0].in),
      new Date(completed[0].out as string),
      { dailyHours: Number(policy.dailyHours), breakMins: policy.breakMins, breakThresholdHours: Number(policy.breakThresholdHours) }
    );
    return { checkInTime: firstIn, checkOutTime: lastOut, workingMins, overtimeMins };
  }

  // 다중 세션: 각 세션 실근무분 합산 (세션 사이 = 휴게)
  let total = 0;
  for (const s of completed) {
    total += Math.max(0, (new Date(s.out as string).getTime() - new Date(s.in).getTime()) / 60000);
  }
  total = Math.round(total);
  const dailyMins = Number(policy.dailyHours) * 60;
  return { checkInTime: firstIn, checkOutTime: lastOut, workingMins: total, overtimeMins: Math.max(0, total - dailyMins) };
}

/** KST 현재 시각이 정책 표준 근무시간(checkInTime~checkOutTime) 안인지. */
export function isWithinWorkHours(policyCheckIn: string, policyCheckOut: string, nowKst: Date): boolean {
  const hh = String(nowKst.getUTCHours()).padStart(2, "0");
  const mm = String(nowKst.getUTCMinutes()).padStart(2, "0");
  const cur = `${hh}:${mm}`;
  const start = String(policyCheckIn).slice(0, 5);
  const end = String(policyCheckOut).slice(0, 5);
  return cur >= start && cur <= end;
}
