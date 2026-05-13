import { db } from "../../db";
import { donations, otherRevenues, revenueCategories } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { eq, and, sql, between } from "drizzle-orm";

export const config = { path: "/api/admin-finance-pl-summary" };

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const fiscalYearParam = url.searchParams.get("fiscalYear");
  const fiscalYear = fiscalYearParam ? Number(fiscalYearParam) : new Date().getFullYear();

  const yearStart = `${fiscalYear}-01-01`;
  const yearEnd   = `${fiscalYear}-12-31`;

  // ── 1. 후원 집계 (status='completed', 월별 분해) ──
  let donationGross = 0;
  let donationRefund = 0;
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
          sql`EXTRACT(YEAR FROM COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt})) = ${fiscalYear}`
        )
      )
      .groupBy(sql`EXTRACT(MONTH FROM COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt}))`);

    for (const row of donRows) {
      const m = Number(row.month);
      const g = Number(row.gross);
      donationByMonth[m].gross = g;
      donationGross += g;
    }
  } catch (err: any) {
    console.warn("[pl-summary] 후원 집계 실패", err);
  }

  // ── 2. 후원 외 수입 집계 (status='approved', 카테고리별) ──
  let otherGross = 0;
  let otherRefund = 0;
  const otherByMonth: Record<number, { gross: number; refund: number }> = {};
  for (let m = 1; m <= 12; m++) otherByMonth[m] = { gross: 0, refund: 0 };

  // 카테고리 맵 (separate query)
  let catMap = new Map<number, { code: string; name: string }>();
  try {
    const cats = await db
      .select({ id: revenueCategories.id, code: revenueCategories.code, name: revenueCategories.name })
      .from(revenueCategories);
    for (const c of cats) catMap.set(c.id, { code: c.code, name: c.name });
  } catch (err: any) {
    console.warn("[pl-summary] 카테고리 조회 실패", err);
  }

  // 카테고리별 순수익 집계
  const catNetMap = new Map<number, { code: string; name: string; gross: number; refund: number }>();
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
          sql`${otherRevenues.recognizedAt}::date BETWEEN ${yearStart}::date AND ${yearEnd}::date`
        )
      )
      .groupBy(otherRevenues.categoryId, sql`EXTRACT(MONTH FROM ${otherRevenues.recognizedAt}::date)`);

    for (const row of otherRows) {
      const catId = row.categoryId;
      const m = Number(row.month);
      const g = Number(row.gross);
      const r = Number(row.refund);

      otherByMonth[m].gross += g;
      otherByMonth[m].refund += r;
      otherGross += g;
      otherRefund += r;

      const cat = catMap.get(catId) || { code: String(catId), name: "기타" };
      if (!catNetMap.has(catId)) {
        catNetMap.set(catId, { code: cat.code, name: cat.name, gross: 0, refund: 0 });
      }
      const entry = catNetMap.get(catId)!;
      entry.gross += g;
      entry.refund += r;
    }
  } catch (err: any) {
    console.warn("[pl-summary] 후원 외 수입 집계 실패", err);
  }

  const otherByCategory = Array.from(catNetMap.values())
    .map(c => ({ code: c.code, name: c.name, gross: c.gross, refund: c.refund, net: c.gross - c.refund }))
    .sort((a, b) => b.net - a.net);

  // ── 3. 월별 통합 ──
  const monthly = [];
  for (let m = 1; m <= 12; m++) {
    const revenue = donationByMonth[m].gross + otherByMonth[m].gross - otherByMonth[m].refund;
    const expenditure = 0; // Phase 22-C에서 구현
    monthly.push({ month: m, revenue, expenditure, net: revenue - expenditure });
  }

  // ── 4. 응답 조립 ──
  const donationNet = donationGross - donationRefund;
  const otherNet = otherGross - otherRefund;
  const totalNet = donationNet + otherNet;
  const expenditureTotal = 0; // Phase 22-C
  const netIncome = totalNet - expenditureTotal;

  return new Response(JSON.stringify({
    ok: true,
    data: {
      fiscalYear,
      revenue: {
        donations: {
          gross: donationGross,
          refund: donationRefund,
          net: donationNet,
        },
        other: {
          gross: otherGross,
          refund: otherRefund,
          net: otherNet,
          byCategory: otherByCategory,
        },
        totalNet,
      },
      expenditure: {
        total: expenditureTotal,
        byCategory: [],
      },
      netIncome,
      monthly,
    },
  }), { headers: { "Content-Type": "application/json" } });
}
