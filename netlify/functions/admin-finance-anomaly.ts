/**
 * GET /api/admin-finance-anomaly
 * 이상 지출 패턴 감지 — 계정과목별 이번 달 누적 지출 vs 전월 동기 지출
 *   전월 대비 +50% 이상 급증 → "급증" 플래그
 *
 * Query: ?year=YYYY&month=MM  (생략 시 KST 현재 월)
 *        ?threshold=50        (급증 판정 % — 기본 50)
 *
 * 화면 배지용 — cron 이메일 알림 없음 (Phase 22-D-R3 §3.2)
 * 데이터 소스: vouchers status='approved' (전표 = 확정 지출)
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-finance-anomaly" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "이상 패턴 감지 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const year   = parseInt(url.searchParams.get("year")  || String(kstNow.getUTCFullYear()));
  const month  = parseInt(url.searchParams.get("month") || String(kstNow.getUTCMonth() + 1));
  const threshold = parseInt(url.searchParams.get("threshold") || "50");

  // 이번 달 범위
  const mm         = String(month).padStart(2, "0");
  const thisStart  = `${year}-${mm}-01`;
  const nextMonth  = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  // 전월 범위 + 전월 "동기" 끝 (이번 달 경과 일수만큼)
  const prevY = month === 1 ? year - 1 : year;
  const prevM = month === 1 ? 12 : month - 1;
  const prevStart = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
  // 이번 달 며칠까지 진행됐는지 (현재 월이면 오늘, 과거/미래 월이면 말일까지)
  const isCurrentMonth = year === kstNow.getUTCFullYear() && month === kstNow.getUTCMonth() + 1;
  const dayOfMonth = isCurrentMonth ? kstNow.getUTCDate() : 31;
  // 전월 동기 끝: 전월 1일 + (dayOfMonth)일 — 전월 말일 초과 시 전월 전체로 클램프됨 (date 연산이 자동 처리 안 하므로 명시)
  const prevSyncEnd = `${prevY}-${String(prevM).padStart(2, "0")}-01`;

  // 계정과목별 이번 달 / 전월 동기 지출 집계 (단일 쿼리)
  let rows: any[] = [];
  try {
    const r: any = await db.execute(sql`
      SELECT
        account_code,
        MAX(account_name) AS account_name,
        COALESCE(SUM(amount) FILTER (
          WHERE voucher_date >= ${thisStart} AND voucher_date < ${nextMonth}
        ), 0)::bigint AS this_month,
        COALESCE(SUM(amount) FILTER (
          WHERE voucher_date >= ${prevStart}
            AND voucher_date < (${prevSyncEnd}::date + ${dayOfMonth} * INTERVAL '1 day')
            AND voucher_date < ${thisStart}
        ), 0)::bigint AS prev_sync
      FROM vouchers
      WHERE is_template = FALSE
        AND status = 'approved'
        AND voucher_date >= ${prevStart} AND voucher_date < ${nextMonth}
      GROUP BY account_code
    `);
    rows = (r?.rows ?? r ?? []) as any[];
  } catch (err: any) {
    return jsonError("aggregate_vouchers", err);
  }

  const items = rows.map((r: any) => {
    const thisMonth = Number(r.this_month);
    const prevSync  = Number(r.prev_sync);
    // 증감률: 전월 동기 0이면서 이번 달 지출 있으면 신규(증가율 표시 N/A지만 급증 처리)
    let changeRate: number | null = null;
    let surge = false;
    if (prevSync > 0) {
      changeRate = Math.round(((thisMonth - prevSync) / prevSync) * 100);
      surge = changeRate >= threshold;
    } else if (thisMonth > 0) {
      changeRate = null;        // 전월 동기 0 → 비율 계산 불가
      surge = true;             // 신규 발생도 급증으로 표시
    }
    return {
      accountCode: r.account_code,
      accountName: r.account_name,
      thisMonth,
      prevSync,
      changeRate,               // null = 전월 동기 0 (신규)
      surge,                    // true = "급증" 배지 대상
    };
  }).sort((a, b) => b.thisMonth - a.thisMonth);

  const surgeItems = items.filter((i) => i.surge);

  return new Response(jsonKST({
    ok: true,
    data: {
      year, month, threshold,
      period: {
        thisMonth: { start: thisStart, end: nextMonth },
        prevSync:  { start: prevStart, dayOfMonth },
      },
      items,
      surgeItems,               // 급증 계정과목만
      surgeCount: surgeItems.length,
      message: surgeItems.length === 0
        ? "전월 대비 급증 계정과목 없음"
        : `전월 대비 +${threshold}% 이상 급증 계정과목 ${surgeItems.length}건`,
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}
