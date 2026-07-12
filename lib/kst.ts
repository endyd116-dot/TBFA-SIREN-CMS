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
 * raw SQL(db.execute)로 읽은 시각을 클라이언트에 보낼 때 반드시 통과시킨다.
 *
 * 왜 필요한가 (2026-07-12 실측):
 *   drizzle 은 postgres-js 의 날짜 파서를 꺼둔다. 그래서 스키마를 거치는 db.select() 는
 *   Date 로 잘 오지만, **raw SQL(db.execute) 결과의 timestamp 는 "2026-07-12 06:16:56.276"
 *   처럼 시간대 표시가 없는 문자열**로 나온다.
 *   이대로 JSON 에 실으면 브라우저가 '현지시각'으로 오해한다 —
 *   실제로는 UTC 06:16(=한국 15:16)인데 화면엔 "오전 6:16"으로 찍힌다. 정확히 9시간 어긋난다.
 *   (급여 증빙 모달의 교부일이 오후 3시 발송인데 오전 6시로 보이던 원인)
 *
 * ⚠️ **drizzle 컬럼(db.select({ createdAt: table.createdAt }))에는 쓰지 말 것.**
 *    그건 값이 아니라 컬럼 정의다. 이 함수는 **raw SQL 행의 값**(row.created_at)에만 쓴다.
 *
 * 안전하게 설계했다:
 *   · 날짜 전용("2026-07-12")은 그대로 — 시각이 아니므로 건드리면 UI가 깨진다
 *   · 이미 시간대가 붙은 값(Z, +09:00)도 그대로 — 이중 변환 방지
 *   · 시간대 없는 시각만 'Z'를 붙여 UTC임을 명시 (저장은 항상 UTC)
 */
export function isoUTC(v: any): any {
  if (v == null) return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v !== "string") return v;

  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;                 // 날짜 전용 — 시각 아님
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(v)) return v;             // 이미 시간대 있음
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/);
  if (m) return `${m[1]}T${m[2]}Z`;                            // 시간대 없는 시각 → UTC 명시
  return v;
}

/**
 * 응답 JSON 직렬화 — **모든 API 응답은 이걸로 만든다.**
 *
 * 왜 단일 관문이 필요한가:
 *   시각이 시간대 표시 없이 새어 나가는 경로가 한둘이 아니다 —
 *     · xxxAt: r.xxx_at            (필드별 매핑)
 *     · { ...r }  /  jsonOk(rows)  (raw 행 통째로)
 *     · SELECT created_at AS "createdAt"   (SQL 별칭)
 *     · date: s.decided_at         (이름이 At 으로 안 끝남)
 *   패턴을 하나씩 쫓으면 반드시 빠뜨린다. 그래서 **나가는 길목 한 곳**에서 막는다.
 *   여기를 통과하면 어떤 모양으로 담겼든 시각은 UTC 표시(Z)가 붙는다.
 *
 * 안전: isoUTC 는 날짜 전용("2026-07-12")·이미 시간대 붙은 값·숫자·일반 문자열을 건드리지 않는다.
 *       Date 객체는 JSON 이 먼저 ISO(Z 포함)로 바꾸므로 그대로 통과한다.
 */
export function jsonKST(body: unknown, _replacer?: unknown, space?: string | number): string {
  /* JSON.stringify 를 그대로 대체할 수 있게 인자 모양을 맞춘다.
     replacer 자리는 우리가 쓰므로 무시하고, 들여쓰기(space)만 그대로 넘긴다. */
  return JSON.stringify(body, (_key, value) => isoUTC(value), space);
}

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
