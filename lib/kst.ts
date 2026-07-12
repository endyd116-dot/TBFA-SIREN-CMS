// lib/kst.ts
// 시간대 단일 출처 — 이 조직은 한국에서만 운영한다. 사람이 보고 판단하는 날짜·시각은 전부 KST다.
//
// 왜 이 파일이 필요한가:
//   서버(Netlify Functions)는 UTC로 돈다. 그래서 `new Date().toISOString().slice(0,10)` 은
//   'UTC 오늘'이지 '한국 오늘'이 아니다. 한국 시각으로 자정~아침 9시 사이에는 **하루 전 날짜**가 나온다.
//   실제로 새벽에 근태 화면을 열면 어제 날짜가 조회되고, 밤에 지출을 등록하면 어제로 기록됐다.
//   → '오늘'이 필요한 모든 곳은 여기 있는 todayKST()를 쓴다.
//
// 저장은 UTC 유지 (Postgres timestamp). 변환은 '사람에게 보여주거나 날짜로 판정할 때'만 한다.
//
// SQL에서 저장된 시각을 한국 날짜로 볼 때는 두 단계로 변환한다:
//   (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')
// 한 번만 걸면 월·일 경계에서 옆 날짜로 새어 나간다.

/** UTC Date → KST 시각으로 옮긴 Date. getUTC*() 로 읽으면 KST 값이 나온다. */
export const toKST = (d: Date): Date => new Date(d.getTime() + 9 * 3_600_000);

/** 지금(서버 UTC) → KST Date */
export const nowKST = (): Date => toKST(new Date());

/** KST 기준 'YYYY-MM-DD' — '오늘'이 필요하면 무조건 이걸 쓴다 */
export const todayKST = (): string => nowKST().toISOString().slice(0, 10);

/** 어떤 시각의 KST 날짜 'YYYY-MM-DD' */
export const dateKST = (d: Date | string | number): string =>
  toKST(new Date(d)).toISOString().slice(0, 10);

/** KST 기준 'HH:MM' */
export const hhmmKST = (d?: Date): string => {
  const k = d ? toKST(d) : nowKST();
  return `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
};

/** 사람에게 보여줄 KST 문자열 (예: "2026. 7. 12. 오후 3:17") */
export function fmtKST(
  d: Date | string | number | null | undefined,
  opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  if (d == null || d === "") return "-";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "-";
  return dt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", ...opts });
}

/** 사람에게 보여줄 KST 날짜만 (예: "2026. 7. 12.") */
export const fmtKSTDate = (d: Date | string | number | null | undefined): string =>
  fmtKST(d, { dateStyle: "medium" });
