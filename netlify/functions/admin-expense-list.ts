import { db } from "../../db";
import { expenses, expenseCategories } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { eq, and, sql, desc, gte, lte } from "drizzle-orm";
import { resolvePeriod } from "../../lib/period-filter";

export const config = { path: "/api/admin-expense-list" };

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const { startDate, endDate, period, fiscalYear } = resolvePeriod({
    period:     url.searchParams.get("period"),
    startDate:  url.searchParams.get("startDate"),
    endDate:    url.searchParams.get("endDate"),
    fiscalYear: url.searchParams.get("fiscalYear"),
  });

  const status = url.searchParams.get("status"); // draft|approved|rejected|all
  const categoryIdParam = url.searchParams.get("categoryId");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "30")));
  const offset = (page - 1) * limit;

  // 카테고리 맵 (separate query)
  const catMap = new Map<number, { code: string; name: string }>();
  try {
    const cats = await db
      .select({ id: expenseCategories.id, code: expenseCategories.code, name: expenseCategories.name })
      .from(expenseCategories);
    for (const c of cats) catMap.set(c.id, { code: c.code, name: c.name });
  } catch (err: any) {
    console.warn("[expense-list] 카테고리 조회 실패", err);
  }

  // 조건 빌드 — period 기반 날짜 범위 (occurred_at 기준)
  // fiscal_year 필터: year 모드(하위호환 포함)에서만 추가 (period=year → fiscalYear 있음)
  const conditions: any[] = [
    gte(expenses.occurredAt, startDate),
    lte(expenses.occurredAt, endDate),
  ];
  if (fiscalYear !== null) {
    conditions.push(eq(expenses.fiscalYear, fiscalYear));
  }
  if (status && status !== "all") {
    conditions.push(eq(expenses.status, status));
  }
  if (categoryIdParam) {
    conditions.push(eq(expenses.categoryId, Number(categoryIdParam)));
  }
  const where = and(...conditions);

  // 합계
  let summary = { totalAmount: 0, totalRefund: 0, netAmount: 0 };
  try {
    const sumRows = await db
      .select({
        totalAmount: sql<string>`COALESCE(SUM(${expenses.amount}), 0)`,
        totalRefund: sql<string>`COALESCE(SUM(${expenses.refundAmount}), 0)`,
      })
      .from(expenses)
      .where(where);
    if (sumRows[0]) {
      const ta = Number(sumRows[0].totalAmount);
      const tr = Number(sumRows[0].totalRefund);
      summary = { totalAmount: ta, totalRefund: tr, netAmount: ta - tr };
    }
  } catch (err: any) {
    console.warn("[expense-list] 합계 조회 실패", err);
  }

  // 총 건수
  let total = 0;
  try {
    const cntRows = await db
      .select({ cnt: sql<string>`COUNT(*)` })
      .from(expenses)
      .where(where);
    total = Number(cntRows[0]?.cnt || 0);
  } catch (err: any) {
    console.warn("[expense-list] 건수 조회 실패", err);
  }

  // 목록
  let rows: typeof expenses.$inferSelect[] = [];
  try {
    rows = await db
      .select()
      .from(expenses)
      .where(where)
      .orderBy(desc(expenses.occurredAt), desc(expenses.id))
      .limit(limit)
      .offset(offset);
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "지출 목록 조회 실패", step: "select_expenses",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }

  const items = rows.map(r => {
    const cat = catMap.get(r.categoryId) || { code: "", name: "" };
    const amt = Number(r.amount);
    const refund = Number(r.refundAmount);
    return {
      id: r.id,
      fiscalYear: r.fiscalYear,
      occurredAt: r.occurredAt,
      categoryId: r.categoryId,
      categoryCode: cat.code,
      categoryName: cat.name,
      amount: amt,
      payeeName: r.payeeName,
      description: r.description,
      receiptUrl: r.receiptUrl,
      status: r.status,
      refundAmount: refund,
      netAmount: amt - refund,
      recordedBy: r.recordedBy,
      recordedAt: r.recordedAt,
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt,
      rejectionReason: r.rejectionReason,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });

  return new Response(JSON.stringify({
    ok: true,
    data: {
      items, total, page, limit, summary,
      period, startDate, endDate,
    },
  }), { headers: { "Content-Type": "application/json" } });
}
