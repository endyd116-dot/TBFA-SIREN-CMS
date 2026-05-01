/**
 * GET /api/admin/stats — 대시보드 차트용 통계
 */
import { sql, eq, and, gte } from "drizzle-orm";
import { db, donations, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.res;

  try {
    /* 1. 최근 12개월 후원금 추이 */
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    const monthlyRows = await db
      .select({
        ym: sql<string>`TO_CHAR(${donations.createdAt}, 'YYYY-MM')`,
        total: sql<number>`COALESCE(SUM(${donations.amount}), 0)`,
      })
      .from(donations)
      .where(and(eq(donations.status, "completed"), gte(donations.createdAt, twelveMonthsAgo)))
      .groupBy(sql`TO_CHAR(${donations.createdAt}, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${donations.createdAt}, 'YYYY-MM')`);

    /* 12개월 빈 곳 0으로 채우기 */
    const monthlyMap = new Map(monthlyRows.map(r => [r.ym, Number(r.total)]));
    const labels: string[] = [];
    const values: number[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(twelveMonthsAgo);
      d.setMonth(d.getMonth() + i);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      labels.push(`${d.getMonth() + 1}월`);
      values.push((monthlyMap.get(ym) || 0) / 1_000_000); // 백만원 단위
    }

    /* 2. 회원 분포 */
    const memberDist = await db
      .select({
        type: members.type,
        c: sql<number>`COUNT(*)`,
      })
      .from(members)
      .groupBy(members.type);

    const distMap: Record<string, number> = {};
    memberDist.forEach(r => { distMap[r.type] = Number(r.c); });

    /* 3. 최근 활동 (간단히 최근 결제 5건) */
    const recent = await db
      .select({
        id: donations.id,
        donorName: donations.donorName,
        amount: donations.amount,
        type: donations.type,
        status: donations.status,
        createdAt: donations.createdAt,
      })
      .from(donations)
      .orderBy(sql`${donations.createdAt} DESC`)
      .limit(5);

    return ok({
      monthlyDonations: { labels, values },
      memberDistribution: {
        regular: distMap.regular || 0,
        onetime: 0, // donations 테이블에서 따로 계산하면 더 정확하지만 간략
        family: distMap.family || 0,
        volunteer: distMap.volunteer || 0,
        admin: distMap.admin || 0,
      },
      recentActivity: recent,
    });
  } catch (err) {
    console.error("[admin-stats]", err);
    return serverError("통계 조회 중 오류", err);
  }
};

export const config = { path: "/api/admin/stats" };