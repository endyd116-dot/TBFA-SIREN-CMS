/**
 * 기간 필터 헬퍼 (Phase 22-B-R1)
 * period: 'day'|'week'|'month'|'half_year'|'year'|'custom'  기본값 = 'month'
 * 하위호환: fiscalYear(숫자) 전달 시 해당 연도 1/1~12/31 변환
 *
 * 모든 날짜 계산은 KST(UTC+9) 기준.
 */

export interface PeriodRange {
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  period: string;
  fiscalYear: number | null;  // year 모드일 때만 채움 (expenses.fiscal_year 필터용)
  includeMonthly: boolean;    // pl-summary monthly[] 포함 여부
}

function kstToday(): Date {
  const now = new Date();
  // UTC 시각에 9시간 더해 KST 날짜 기준 계산
  return new Date(now.getTime() + 9 * 60 * 60 * 1000);
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function toDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function resolvePeriod(params: {
  period?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  fiscalYear?: string | null;
}): PeriodRange {
  const { period: rawPeriod, startDate: rawStart, endDate: rawEnd, fiscalYear: rawFy } = params;

  // ── 하위호환: fiscalYear만 있으면 year 모드로 변환
  if (!rawPeriod && !rawStart && !rawEnd && rawFy) {
    const fy = Number(rawFy);
    if (Number.isFinite(fy) && fy > 1900 && fy < 2200) {
      return {
        startDate: `${fy}-01-01`,
        endDate: `${fy}-12-31`,
        period: "year",
        fiscalYear: fy,
        includeMonthly: true,
      };
    }
  }

  const period = rawPeriod || "month";
  const today = kstToday();

  let startDate: string;
  let endDate: string;
  let fiscalYear: number | null = null;
  let includeMonthly = false;

  switch (period) {
    case "day": {
      const s = toDateStr(today);
      startDate = s;
      endDate = s;
      break;
    }
    case "week": {
      // 이번 주 월요일(0=일요일 → 보정)
      const day = today.getUTCDay(); // 0=Sun … 6=Sat
      const diffToMon = (day === 0 ? -6 : 1 - day);
      const mon = new Date(today.getTime() + diffToMon * 86400000);
      const sun = new Date(mon.getTime() + 6 * 86400000);
      startDate = toDateStr(mon);
      endDate = toDateStr(sun);
      break;
    }
    case "month": {
      const y = today.getUTCFullYear();
      const m = today.getUTCMonth(); // 0-indexed
      const firstDay = new Date(Date.UTC(y, m, 1));
      const lastDay = new Date(Date.UTC(y, m + 1, 0));
      startDate = toDateStr(firstDay);
      endDate = toDateStr(lastDay);
      break;
    }
    case "half_year": {
      const sixMonthsAgo = new Date(today.getTime() - 182 * 86400000);
      startDate = toDateStr(sixMonthsAgo);
      endDate = toDateStr(today);
      includeMonthly = true;
      break;
    }
    case "year": {
      const y = today.getUTCFullYear();
      startDate = `${y}-01-01`;
      endDate = `${y}-12-31`;
      fiscalYear = y;
      includeMonthly = true;
      break;
    }
    case "custom": {
      startDate = rawStart || toDateStr(today);
      endDate = rawEnd || toDateStr(today);
      // 60일 이상이면 monthly 포함
      const diffDays = (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000;
      includeMonthly = diffDays >= 60;
      break;
    }
    default: {
      // 알 수 없는 period → month 기본
      const y = today.getUTCFullYear();
      const m = today.getUTCMonth();
      startDate = toDateStr(new Date(Date.UTC(y, m, 1)));
      endDate = toDateStr(new Date(Date.UTC(y, m + 1, 0)));
      break;
    }
  }

  return { startDate, endDate, period, fiscalYear, includeMonthly };
}
