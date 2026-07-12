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

/* ══════════════════════════════════════════════════════════════
   KST 기준 연·월·일·요일·시 — 서버에서 new Date().getMonth() 같은 걸 쓰면 안 되는 이유

   서버는 UTC로 돈다. 그래서 `new Date().getHours()` 는 **한국 시각보다 9시간 이르다.**
   연·월·일도 한국 자정~아침 9시 사이에는 하루 전 값이 나온다.
     · 감사 로그 CSV의 시각이 9시간 어긋나 있었다
     · 새벽에 뽑은 출금 파일의 생성일자가 어제로 찍혔다
     · 기념일·연차·카드만료 판정이 하루 어긋났다

   ⚠️ 서버 프로세스의 시간대(TZ)를 서울로 바꾸는 방법은 절대 쓰면 안 된다.
      DB 드라이버가 timestamp 문자열을 `new Date(x)` 로 파싱하는데, 프로세스가 서울이면
      UTC로 저장된 값을 한국시각으로 오해해서 **읽는 모든 시각이 9시간 밀린다**(실측 확인).
      → 저장·전송은 UTC 그대로 두고, '사람이 보거나 날짜로 판정할 때'만 아래 함수로 변환한다.

   아래 함수들은 프로세스 시간대와 무관하게 항상 같은 값을 준다 (getUTC* 로 읽으므로).
   ══════════════════════════════════════════════════════════════ */
const parts = (d?: Date | string | number) => (d == null ? nowKST() : toKST(new Date(d)));

/** KST 연도 */
export const yearKST = (d?: Date | string | number): number => parts(d).getUTCFullYear();
/** KST 월 (0~11 — Date.getMonth() 와 같은 규칙) */
export const monthKST0 = (d?: Date | string | number): number => parts(d).getUTCMonth();
/** KST 월 (1~12 — 사람이 읽는 규칙) */
export const monthKST = (d?: Date | string | number): number => parts(d).getUTCMonth() + 1;
/** KST 일 */
export const dayKST = (d?: Date | string | number): number => parts(d).getUTCDate();
/** KST 요일 (0=일 ~ 6=토) */
export const dowKST = (d?: Date | string | number): number => parts(d).getUTCDay();
/** KST 시 (0~23) */
export const hourKST = (d?: Date | string | number): number => parts(d).getUTCHours();
/** KST 분 */
export const minuteKST = (d?: Date | string | number): number => parts(d).getUTCMinutes();

/** KST 'YYYYMMDD' (파일명·전문 헤더용) */
export const ymdKST = (d?: Date | string | number): string => {
  const k = parts(d);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, "0")}${String(k.getUTCDate()).padStart(2, "0")}`;
};
/** KST 'HHMM' */
export const hhmmKSTCompact = (d?: Date | string | number): string => {
  const k = parts(d);
  return `${String(k.getUTCHours()).padStart(2, "0")}${String(k.getUTCMinutes()).padStart(2, "0")}`;
};
/** KST 'YYYY-MM-DD HH:MM' (CSV·로그 표시용) */
export const stampKST = (d?: Date | string | number): string => {
  const k = parts(d);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}-${String(k.getUTCDate()).padStart(2, "0")}` +
    ` ${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
};

/**
 * SQL 안에서 '한국 기준 오늘'.
 *
 * Postgres의 CURRENT_DATE 는 세션 시간대(기본 UTC) 기준이라 한국 새벽엔 어제가 나온다.
 * 세션 시간대를 서울로 바꾸는 것도 금물이다 — DEFAULT now() 로 새로 쓰는 행이 KST 벽시계로
 * 저장되면서 기존 UTC 저장분과 섞여버린다.
 * → 쿼리에서 CURRENT_DATE 대신 이 식을 쓴다.
 */
export const SQL_TODAY_KST = "(NOW() AT TIME ZONE 'Asia/Seoul')::date";
/** SQL: 저장된 timestamp(UTC) 컬럼을 한국 날짜로 (예: kstDateSql('s.paid_at')) */
export const kstDateSql = (col: string): string =>
  `((${col}) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date`;
