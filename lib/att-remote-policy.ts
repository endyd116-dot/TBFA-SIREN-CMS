// lib/att-remote-policy.ts
// 재택근무 보고서 정책 — 제출 기한 3일 · 미제출 시 근무 불인정
//
// 정책(Swain 2026-07-12):
//   1) 재택근무일에는 일일 보고서를 낸다. 원칙은 당일 제출.
//   2) 늦어도 재택일로부터 3일 안에는 내야 한다 (재택일 + 3일 자정까지 · KST).
//   3) 기한을 넘기면 제출할 수 없고, 그 날은 근무로 인정하지 않는다 (급여 출근일에서 제외).
//   4) 사정이 있으면 관리자가 예외 인정할 수 있다 → 그 날은 다시 근무로 인정된다.
//   5) 적용 시작: 2026년 7월 1일. 그 전 날짜는 종전대로 전부 인정.
//
// 설계 원칙:
//   근태 기록(출퇴근 시각)은 사실대로 두고, 급여 집계에서만 뺀다.
//   → 나중에 보고서를 내거나 관리자가 예외 인정하면 재집계 시 자동으로 다시 인정된다.
//     (기록을 훼손하지 않으므로 되돌리기가 안전하다)

import { dateKST } from "./kst";

/** 이 날짜부터 '보고서 미제출 = 근무 불인정' 규칙을 적용 (KST 기준 날짜) */
export const REMOTE_REPORT_REQUIRED_FROM = "2026-07-01";

/** 제출 기한 — 재택일로부터 며칠 (재택일 + 3일 23:59:59 KST 까지) */
export const REMOTE_REPORT_DEADLINE_DAYS = 3;

/** 근무로 집계되는 상태 (휴가·공휴일·결근 제외) */
export const WORKED_STATUSES = ["NORMAL", "LATE", "EARLY_LEAVE"] as const;

/** 보고서가 '제출된 것으로 인정'되는 상태 — 정상 제출 + 관리자 예외 인정 */
export const ACCEPTED_REPORT_STATUSES = ["SUBMITTED", "EXEMPTED"] as const;

export const REMOTE_REPORT_NOTICE =
  `재택근무일에는 일일 보고서를 제출해야 합니다. 원칙은 당일 제출이며, 늦어도 재택일로부터 ${REMOTE_REPORT_DEADLINE_DAYS}일 안에는 제출해야 합니다. ` +
  `기한이 지나면 제출할 수 없고 그 날은 근무로 인정되지 않습니다(급여 산정 제외). 사정이 있으면 관리자에게 예외 인정을 요청하세요.`;

/* ── KST 날짜 유틸 (서버·클라이언트 공용 · 라이브러리 없이) ── */

/** 오늘 날짜 (KST, YYYY-MM-DD) — 구현은 lib/kst.ts 한 곳 (중복 구현이 갈라지지 않게) */
export function todayKstDate(now: Date = new Date()): string {
  return dateKST(now);
}

/** YYYY-MM-DD 두 날짜의 차이(일). b - a */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.round((tb - ta) / 86400000);
}

/** 재택일 → 제출 마감일 (YYYY-MM-DD, 이 날 자정까지 제출 가능) */
export function reportDeadline(workDate: string): string {
  const t = Date.parse(`${String(workDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return String(workDate).slice(0, 10);
  return new Date(t + REMOTE_REPORT_DEADLINE_DAYS * 86400000).toISOString().slice(0, 10);
}

/**
 * 제출 기한이 지났는가 (그래서 더 이상 제출할 수 없는가).
 * 규칙 적용 전(2026-07-01 이전) 날짜는 기한 개념이 없으므로 항상 false.
 */
export function isReportClosed(workDate: string, today: string = todayKstDate()): boolean {
  const d = String(workDate).slice(0, 10);
  if (d < REMOTE_REPORT_REQUIRED_FROM) return false;
  return today > reportDeadline(d);
}

/** 마감까지 남은 일수. 0이면 오늘 마감, 음수면 이미 지남. */
export function daysLeftToDeadline(workDate: string, today: string = todayKstDate()): number {
  return daysBetween(today, reportDeadline(workDate));
}

/** 화면에 띄울 기한 배지 문구·색 (직원·관리자 공용) */
export function deadlineBadge(workDate: string, today: string = todayKstDate()): {
  text: string; tone: "danger" | "warn" | "info" | "closed";
} {
  const d = String(workDate).slice(0, 10);
  if (d < REMOTE_REPORT_REQUIRED_FROM) return { text: "기한 없음", tone: "info" };
  const left = daysLeftToDeadline(d, today);
  if (left < 0)  return { text: "기한 경과 — 근무 불인정", tone: "closed" };
  if (left === 0) return { text: "오늘 마감", tone: "danger" };
  if (left === 1) return { text: "내일 마감", tone: "warn" };
  return { text: `${left}일 남음`, tone: "info" };
}
