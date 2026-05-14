import { db } from "../../db";
import { donations, otherRevenues, revenueCategories, expenses, expenseCategories } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { eq, and, sql } from "drizzle-orm";
import { resolvePeriod } from "../../lib/period-filter";
import { getCache, setCache } from "../../lib/cache";

export const config = { path: "/api/admin-finance-pl-summary" };

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const { startDate, endDate, period, fiscalYear, includeMonthly } = resolvePeriod({
    period:     url.searchParams.get("period"),
    startDate:  url.searchParams.get("startDate"),
    endDate:    url.searchParams.get("endDate"),
    fiscalYear: url.searchParams.get("fiscalYear"),
  });

  /* ★ 버그픽스 #13-2: 손익 요약은 읽기 전용 집계 — 기간 키별 3분 캐시.
   *  donations/expenses/other_revenues 풀집계가 매 진입마다 도는 부담을 줄임. */
  const cacheKey = `pl-summary-v1:${period}:${startDate}:${endDate}:${fiscalYear ?? "-"}:${includeMonthly ? "m" : "-"}`;
  const cached = await getCache<Record<string, any>>(cacheKey);
  if (cached) {
    return new Response(JSON.stringify({ ok: true, data: { ...cached, cached: true } }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 1. 후원 집계 (status='completed' gross + status='refunded' refund) ──
  let donationGross = 0;
  let donationRefund = 0;
  // monthly 집계용 (includeMonthly=true일 때만 필요하지만 항상 초기화)
  const donationByMonth: Record<number, { gross: number; refund: number }> = {};
  for (let m = 1; m <= 12; m++) donationByMonth[m] = { gross: 0, refund: 0 };

  try {
    const donRows = await db
      .select({
        month: sql<string>`EXTRACT(MONTH FROM COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt}))`,
        gross: sql<string>`COALESCE(SUM(${donations.amount}), 0)`,
      })
      .from(donations)
      .where(
        and(
          eq(donations.status, "completed"),
          sql`COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt})::date BETWEEN ${startDate}::date AND ${endDate}::date`
        )
      )
      .groupBy(sql`EXTRACT(MONTH FROM COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt}))`);

    for (const row of donRows) {
      const m = Number(row.month);
      const g = Number(row.gross);
      if (donationByMonth[m]) donationByMonth[m].gross = g;
      donationGross += g;
    }
  } catch (err: any) {
    console.warn("[pl-summary] 후원 집계 실패", err);
  }

  // BUG-002 fix: 후원 환불(status='refunded') 별도 집계
  try {
    const refundRows = await db
      .select({
        month: sql<string>`EXTRACT(MONTH FROM COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt}))`,
        total: sql<string>`COALESCE(SUM(${donations.amount}), 0)`,
      })
      .from(donations)
      .where(
        and(
          eq(donations.status, "refunded"),
          sql`COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt})::date BETWEEN ${startDate}::date AND ${endDate}::date`
        )
      )
      .groupBy(sql`EXTRACT(MONTH FROM COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt}))`);

    for (const row of refundRows) {
      const m = Number(row.month);
      const t = Number(row.total);
      if (donationByMonth[m]) donationByMonth[m].refund = t;
      donationRefund += t;
    }
  } catch (err: any) {
    console.warn("[pl-summary] 후원 환불 집계 실패", err);
  }

  // ── 2. 후원 외 수입 집계 (status='approved', recognizedAt 기준) ──
  let otherGross = 0;
  let otherRefund = 0;
  const otherByMonth: Record<number, { gross: number; refund: number }> = {};
  for (let m = 1; m <= 12; m++) otherByMonth[m] = { gross: 0, refund: 0 };

  const revCatMap = new Map<number, { code: string; name: string }>();
  try {
    const cats = await db
      .select({ id: revenueCategories.id, code: revenueCategories.code, name: revenueCategories.name })
      .from(revenueCategories);
    for (const c of cats) revCatMap.set(c.id, { code: c.code, name: c.name });
  } catch (err: any) {
    console.warn("[pl-summary] 수입 카테고리 조회 실패", err);
  }

  const otherCatNetMap = new Map<number, { code: string; name: string; gross: number; refund: number }>();
  try {
    const otherRows = await db
      .select({
        categoryId: otherRevenues.categoryId,
        month: sql<string>`EXTRACT(MONTH FROM ${otherRevenues.recognizedAt}::date)`,
        gross: sql<string>`COALESCE(SUM(${otherRevenues.amount}), 0)`,
        refund: sql<string>`COALESCE(SUM(${otherRevenues.refundAmount}), 0)`,
      })
      .from(otherRevenues)
      .where(
        and(
          eq(otherRevenues.status, "approved"),
          sql`${otherRevenues.recognizedAt}::date BETWEEN ${startDate}::date AND ${endDate}::date`
        )
      )
      .groupBy(otherRevenues.categoryId, sql`EXTRACT(MONTH FROM ${otherRevenues.recognizedAt}::date)`);

    for (const row of otherRows) {
      const catId = row.categoryId;
      const m = Number(row.month);
      const g = Number(row.gross);
      const r = Number(row.refund);

      if (otherByMonth[m]) { otherByMonth[m].gross += g; otherByMonth[m].refund += r; }
      otherGross += g;
      otherRefund += r;

      const cat = revCatMap.get(catId) || { code: String(catId), name: "기타" };
      if (!otherCatNetMap.has(catId)) {
        otherCatNetMap.set(catId, { code: cat.code, name: cat.name, gross: 0, refund: 0 });
      }
      const entry = otherCatNetMap.get(catId)!;
      entry.gross += g;
      entry.refund += r;
    }
  } catch (err: any) {
    console.warn("[pl-summary] 후원 외 수입 집계 실패", err);
  }

  const otherByCategory = Array.from(otherCatNetMap.values())
    .map(c => ({ code: c.code, name: c.name, gross: c.gross, refund: c.refund, net: c.gross - c.refund }))
    .sort((a, b) => b.net - a.net);

  // ── 3. 지출 집계 (status='approved', occurred_at 기준) — Phase 22-C ──
  let expenseGross = 0;
  let expenseRefund = 0;
  const expenseByMonth: Record<number, { gross: number; refund: number }> = {};
  for (let m = 1; m <= 12; m++) expenseByMonth[m] = { gross: 0, refund: 0 };

  const expCatMap = new Map<number, { code: string; name: string }>();
  try {
    const cats = await db
      .select({ id: expenseCategories.id, code: expenseCategories.code, name: expenseCategories.name })
      .from(expenseCategories);
    for (const c of cats) expCatMap.set(c.id, { code: c.code, name: c.name });
  } catch (err: any) {
    console.warn("[pl-summary] 지출 카테고리 조회 실패", err);
  }

  const expCatNetMap = new Map<number, { code: string; name: string; gross: number; refund: number }>();
  try {
    // fiscal_year 필터: year 모드(하위호환 포함)에서만 추가
    const expConditions: any[] = [
      eq(expenses.status, "approved"),
      sql`${expenses.occurredAt}::date BETWEEN ${startDate}::date AND ${endDate}::date`,
    ];
    if (fiscalYear !== null) {
      expConditions.push(eq(expenses.fiscalYear, fiscalYear));
    }

    const expRows = await db
      .select({
        categoryId: expenses.categoryId,
        month: sql<string>`EXTRACT(MONTH FROM ${expenses.occurredAt}::date)`,
        gross: sql<string>`COALESCE(SUM(${expenses.amount}), 0)`,
        refund: sql<string>`COALESCE(SUM(${expenses.refundAmount}), 0)`,
      })
      .from(expenses)
      .where(and(...expConditions))
      .groupBy(expenses.categoryId, sql`EXTRACT(MONTH FROM ${expenses.occurredAt}::date)`);

    for (const row of expRows) {
      const catId = row.categoryId;
      const m = Number(row.month);
      const g = Number(row.gross);
      const r = Number(row.refund);

      if (expenseByMonth[m]) { expenseByMonth[m].gross += g; expenseByMonth[m].refund += r; }
      expenseGross += g;
      expenseRefund += r;

      const cat = expCatMap.get(catId) || { code: String(catId), name: "기타" };
      if (!expCatNetMap.has(catId)) {
        expCatNetMap.set(catId, { code: cat.code, name: cat.name, gross: 0, refund: 0 });
      }
      const entry = expCatNetMap.get(catId)!;
      entry.gross += g;
      entry.refund += r;
    }
  } catch (err: any) {
    console.warn("[pl-summary] 지출 집계 실패", err);
  }

  const expenseByCategory = Array.from(expCatNetMap.values())
    .map(c => ({ code: c.code, name: c.name, gross: c.gross, refund: c.refund, total: c.gross - c.refund }))
    .sort((a, b) => b.total - a.total);

  // ── 4. 월별 통합 (includeMonthly=true일 때만 포함) ──
  const monthly = includeMonthly
    ? (() => {
        const result = [];
        for (let m = 1; m <= 12; m++) {
          const revenue = (donationByMonth[m].gross - donationByMonth[m].refund)
                        + (otherByMonth[m].gross - otherByMonth[m].refund);
          const expenditure = expenseByMonth[m].gross - expenseByMonth[m].refund;
          result.push({ month: m, revenue, expenditure, net: revenue - expenditure });
        }
        return result;
      })()
    : undefined;

  // ── 5. 응답 조립 ──
  const donationNet = donationGross - donationRefund;
  const otherNet = otherGross - otherRefund;
  const totalNet = donationNet + otherNet;
  const expenditureTotal = expenseGross - expenseRefund;
  const netIncome = totalNet - expenditureTotal;

  const responseData: Record<string, any> = {
    period, startDate, endDate,
    ...(fiscalYear !== null ? { fiscalYear } : {}),
    revenue: {
      donations: { gross: donationGross, refund: donationRefund, net: donationNet },
      other: { gross: otherGross, refund: otherRefund, net: otherNet, byCategory: otherByCategory },
      totalNet,
    },
    expenditure: {
      total: expenditureTotal,
      gross: expenseGross,
      refund: expenseRefund,
      byCategory: expenseByCategory,
    },
    netIncome,
  };
  if (monthly !== undefined) responseData.monthly = monthly;

  /* 캐시 저장 (실패해도 응답에 영향 없음) */
  await setCache(cacheKey, responseData, 3 * 60);

  return new Response(JSON.stringify({ ok: true, data: responseData }), {
    headers: { "Content-Type": "application/json" },
  });
}
