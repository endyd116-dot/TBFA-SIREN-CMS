/**
 * GET /api/admin-finance-cashflow
 * 현금흐름표 (단순 입출금 흐름) — 기초/입금/출금/순현금흐름/기말
 *
 * Query: ?startDate=&endDate=  또는  ?period=month|year|...  (period-filter)
 *
 * Phase 22-D-R3 §5.2
 * 데이터 소스: bank_transactions 입출금 (credit=입금, debit=출금)
 *   - 기초 잔액: 기간 시작 직전 거래의 balance_after
 *   - 기말 잔액: 기간 마지막 거래의 balance_after
 *   - 카테고리별 내역: match_type 기준 (donation/revenue/voucher/미분류)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { sql } from "drizzle-orm";
import { resolvePeriod } from "../../lib/period-filter";

export const config = { path: "/api/admin-finance-cashflow" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "현금흐름표 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

// match_type → 입금 카테고리 라벨
const INCOME_LABEL: Record<string, string> = {
  donation:       "후원금",
  donation_batch: "후원금 (묶음정산)",
  revenue:        "후원 외 매출",
};
// match_type → 출금 카테고리 라벨
const EXPENSE_LABEL: Record<string, string> = {
  voucher: "전표 연결 지출",
};

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  // R45 §4-2: 전사 재무 열람은 admin+ (운영자 차단·권한정책 토글)
  if (!(await canAccess(auth.ctx.member.role ?? "", "finance_view"))) {
    return new Response(JSON.stringify({ ok: false, error: "재무 열람 권한이 없습니다", step: "auth_role" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const { startDate, endDate, period } = resolvePeriod({
    period:    url.searchParams.get("period"),
    startDate: url.searchParams.get("startDate"),
    endDate:   url.searchParams.get("endDate"),
    fiscalYear: url.searchParams.get("fiscalYear"),
  });

  // 1. 기초 잔액 — 기간 시작 직전(startDate 미만) 가장 최근 거래의 balance_after
  let openingBalance = 0;
  let hasOpeningData = false;
  try {
    const r: any = await db.execute(sql`
      SELECT balance_after FROM bank_transactions
      WHERE txn_date < ${startDate} AND balance_after IS NOT NULL
      ORDER BY txn_date DESC, id DESC LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (row) { openingBalance = Number(row.balance_after); hasOpeningData = true; }
  } catch (err: any) {
    return jsonError("select_opening", err);
  }

  // 2. 기간 내 입출금 집계 — match_type별 (txn_type: credit=입금, debit=출금)
  let aggRows: any[] = [];
  try {
    const r: any = await db.execute(sql`
      SELECT txn_type, COALESCE(match_type, 'pending') AS match_type,
             COUNT(*) AS cnt, COALESCE(SUM(ABS(amount)), 0)::bigint AS total
      FROM bank_transactions
      WHERE txn_date >= ${startDate} AND txn_date <= ${endDate}
        AND status != 'ignored'
      GROUP BY txn_type, COALESCE(match_type, 'pending')
    `);
    aggRows = (r?.rows ?? r ?? []) as any[];
  } catch (err: any) {
    return jsonError("aggregate", err);
  }

  // 3. 기말 잔액 — 기간 내 마지막 거래의 balance_after (없으면 기초 + 순흐름)
  let closingBalance: number | null = null;
  let hasClosingData = false;
  try {
    const r: any = await db.execute(sql`
      SELECT balance_after FROM bank_transactions
      WHERE txn_date >= ${startDate} AND txn_date <= ${endDate}
        AND balance_after IS NOT NULL
      ORDER BY txn_date DESC, id DESC LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (row) { closingBalance = Number(row.balance_after); hasClosingData = true; }
  } catch (err: any) {
    console.warn("[cashflow] 기말 잔액 조회 실패:", err?.message);
  }

  // 입금·출금 카테고리별 분해
  const inflowByCategory: Array<{ key: string; label: string; amount: number; count: number }> = [];
  const outflowByCategory: Array<{ key: string; label: string; amount: number; count: number }> = [];
  let totalInflow = 0, totalOutflow = 0;

  for (const x of aggRows) {
    const amt = Number(x.total);
    const cnt = Number(x.cnt);
    const mt  = x.match_type as string;
    if (x.txn_type === "credit") {
      totalInflow += amt;
      inflowByCategory.push({
        key: mt,
        label: INCOME_LABEL[mt] || (mt === "pending" ? "미분류 입금" : mt),
        amount: amt, count: cnt,
      });
    } else {
      totalOutflow += amt;
      outflowByCategory.push({
        key: mt,
        label: EXPENSE_LABEL[mt] || (mt === "pending" ? "미분류 출금" : mt),
        amount: amt, count: cnt,
      });
    }
  }
  inflowByCategory.sort((a, b) => b.amount - a.amount);
  outflowByCategory.sort((a, b) => b.amount - a.amount);

  const netCashFlow = totalInflow - totalOutflow;
  // 기말 잔액: 실제 데이터 있으면 그것, 없으면 기초 + 순흐름 (추정)
  const computedClosing = openingBalance + netCashFlow;
  const finalClosing = hasClosingData ? closingBalance! : computedClosing;

  return new Response(JSON.stringify({
    ok: true,
    data: {
      period,
      startDate, endDate,
      openingBalance,                    // 기초 잔액
      hasOpeningData,                    // false = 기간 이전 거래 없음 (기초 0으로 표시)
      inflow: {
        total: totalInflow,
        byCategory: inflowByCategory,
      },
      outflow: {
        total: totalOutflow,
        byCategory: outflowByCategory,
      },
      netCashFlow,                       // 순현금흐름 = 입금 − 출금
      closingBalance: finalClosing,      // 기말 잔액
      closingIsEstimated: !hasClosingData, // true = 기초+순흐름 추정값 (실제 거래 잔액 없음)
      message: `${startDate} ~ ${endDate} 순현금흐름 ${netCashFlow.toLocaleString("ko-KR")}원`,
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}
