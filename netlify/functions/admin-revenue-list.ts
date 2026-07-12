import { jsonKST } from "../../lib/kst";
import { db } from "../../db";
import { otherRevenues, revenueCategories } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { eq, and, sql, desc, like, gte, lte } from "drizzle-orm";
import { resolvePeriod } from "../../lib/period-filter";

export const config = { path: "/api/admin-revenue-list" };

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const { startDate, endDate, period } = resolvePeriod({
    period:     url.searchParams.get("period"),
    startDate:  url.searchParams.get("startDate"),
    endDate:    url.searchParams.get("endDate"),
    fiscalYear: url.searchParams.get("fiscalYear"),
  });

  const status = url.searchParams.get("status"); // draft|approved|rejected|all
  const categoryId = url.searchParams.get("categoryId");
  const payerName = (url.searchParams.get("payerName") || "").trim();
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50")));
  const offset = (page - 1) * limit;

  // 카테고리 맵 (separate query)
  let catMap = new Map<number, { code: string; name: string }>();
  try {
    const cats = await db.select({ id: revenueCategories.id, code: revenueCategories.code, name: revenueCategories.name }).from(revenueCategories);
    for (const c of cats) catMap.set(c.id, { code: c.code, name: c.name });
  } catch (err: any) {
    console.warn("[revenue-list] 카테고리 조회 실패", err);
  }

  // 조건 빌드 — period 기반 날짜 범위
  const conditions: ReturnType<typeof eq>[] = [
    gte(otherRevenues.recognizedAt, startDate) as any,
    lte(otherRevenues.recognizedAt, endDate) as any,
  ];
  if (status && status !== "all") {
    conditions.push(eq(otherRevenues.status, status) as any);
  }
  if (categoryId) {
    conditions.push(eq(otherRevenues.categoryId, Number(categoryId)) as any);
  }
  if (payerName) {
    conditions.push(like(otherRevenues.payerName, `%${payerName}%`) as any);
  }
  const where = and(...conditions);

  // 합계
  let summary = { totalAmount: 0, totalRefund: 0, netAmount: 0 };
  try {
    const sumRows = await db
      .select({
        totalAmount: sql<string>`COALESCE(SUM(${otherRevenues.amount}), 0)`,
        totalRefund: sql<string>`COALESCE(SUM(${otherRevenues.refundAmount}), 0)`,
      })
      .from(otherRevenues)
      .where(where);
    if (sumRows[0]) {
      const ta = Number(sumRows[0].totalAmount);
      const tr = Number(sumRows[0].totalRefund);
      summary = { totalAmount: ta, totalRefund: tr, netAmount: ta - tr };
    }
  } catch (err: any) {
    console.warn("[revenue-list] 합계 조회 실패", err);
  }

  // 총 건수
  let total = 0;
  try {
    const cntRows = await db
      .select({ cnt: sql<string>`COUNT(*)` })
      .from(otherRevenues)
      .where(where);
    total = Number(cntRows[0]?.cnt || 0);
  } catch (err: any) {
    console.warn("[revenue-list] 건수 조회 실패", err);
  }

  // 목록
  let rows: typeof otherRevenues.$inferSelect[] = [];
  try {
    rows = await db
      .select()
      .from(otherRevenues)
      .where(where)
      .orderBy(desc(otherRevenues.recognizedAt), desc(otherRevenues.id))
      .limit(limit)
      .offset(offset);
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "수입 목록 조회 실패", step: "select_revenues",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }

  const items = rows.map(r => {
    const cat = catMap.get(r.categoryId) || { code: "", name: "" };
    return {
      id: r.id,
      fiscalYear: r.fiscalYear,
      recognizedAt: r.recognizedAt,
      categoryId: r.categoryId,
      categoryCode: cat.code,
      categoryName: cat.name,
      amount: Number(r.amount),
      payerName: r.payerName,
      description: r.description,
      receiptUrl: r.receiptUrl,
      status: r.status,
      refundAmount: Number(r.refundAmount),
      recordedBy: r.recordedBy,
      recordedAt: r.recordedAt,
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt,
      rejectionReason: r.rejectionReason,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });

  return new Response(jsonKST({
    ok: true,
    data: {
      items, total, page, limit, summary,
      period, startDate, endDate,
    },
  }), { headers: { "Content-Type": "application/json" } });
}
