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

/**
 * 어드민 직접 수정·정정 결재용: 요약 출퇴근 시각(in/out)으로부터 sessions 배열을 재구성.
 * 어드민이 요약 시각을 수정하면 권위값(summary)과 sessions가 어긋나, 같은 날 직원이
 * 재출근·셀프수정·퇴근하면 stale sessions 기준 재계산이 어드민 수정을 되돌린다(회귀).
 * 이를 막기 위해 sessions를 요약 시각과 정합화한다.
 *  - 출근 시각이 없으면 빈 배열.
 *  - 퇴근 시각이 없으면 진행 중(out=null) 단일 세션 → 직원이 정상 퇴근 가능.
 *  - 다중 세션은 단일로 정규화(어드민 수정은 working_mins를 단일 span으로 재계산하므로 일치).
 *  - carry 로 기존 위치·거점 정보를 보존.
 */
export function rebuildSingleSession(
  checkInISO: string | null,
  checkOutISO: string | null,
  carry?: { inLat?: any; inLng?: any; outLat?: any; outLng?: any; workplaceId?: number | null }
): AttSession[] {
  if (!checkInISO) return [];
  return [{
    in: new Date(checkInISO).toISOString(),
    out: checkOutISO ? new Date(checkOutISO).toISOString() : null,
    inLat: carry?.inLat != null ? String(carry.inLat) : null,
    inLng: carry?.inLng != null ? String(carry.inLng) : null,
    outLat: carry?.outLat != null ? String(carry.outLat) : null,
    outLng: carry?.outLng != null ? String(carry.outLng) : null,
    workplaceId: carry?.workplaceId ?? null,
  }];
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
