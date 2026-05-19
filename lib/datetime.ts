// KST(Asia/Seoul) 시각 표시 헬퍼
// DB는 UTC 저장, UI/이메일 표시만 KST로 통일

const KST = "Asia/Seoul";

function toDate(input: Date | string | number | null | undefined): Date | null {
  if (input === null || input === undefined || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return null;
  return d;
}

// "2026년 5월 19일 오후 3시 25분" — 이메일 본문용
export function fmtKSTForEmail(input: Date | string | number | null | undefined): string {
  const d = toDate(input);
  if (!d) return "-";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const year = get("year");
  const month = String(parseInt(get("month"), 10));
  const day = String(parseInt(get("day"), 10));
  const h24 = parseInt(get("hour"), 10);
  const ampm = h24 < 12 ? "오전" : "오후";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const minute = get("minute");
  return `${year}년 ${month}월 ${day}일 ${ampm} ${h12}시 ${minute}분`;
}

// "2026-05-19" — 날짜만
export function fmtKSTDate(input: Date | string | number | null | undefined): string {
  const d = toDate(input);
  if (!d) return "-";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// "2026-05-19 15:25" — 간결 표기
export function fmtKSTSimple(input: Date | string | number | null | undefined): string {
  const d = toDate(input);
  if (!d) return "-";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

// "2026-05-19T15:25:00+09:00" — ISO 형식 KST
export function toKstIso(input: Date | string | number | null | undefined): string {
  const d = toDate(input);
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+09:00`;
}
