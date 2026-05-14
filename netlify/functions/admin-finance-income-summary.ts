import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { donations, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { sql, and, gte, lte, eq } from "drizzle-orm";
import { resolvePeriod } from "../../lib/period-filter";

export const config = { path: "/api/admin-finance-income-summary" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  // BUG-017 fix: 기간 필터(period) 지원 — 기존 year/month 호출은 하위호환 유지
  const { startDate: sdStr, endDate: edStr, period, fiscalYear, includeMonthly } = resolvePeriod({
    period:     url.searchParams.get("period"),
    startDate:  url.searchParams.get("startDate"),
    endDate:    url.searchParams.get("endDate"),
    fiscalYear: url.searchParams.get("fiscalYear") ?? url.searchParams.get("year"),
  });
  const year = fiscalYear ?? new Date(sdStr + "T00:00:00").getFullYear();
  // month 필드는 응답 호환용 — period 모드에서는 null
  const month: number | null = null;

  try {
    const startDate = new Date(sdStr + "T00:00:00");
    const endDate = new Date(edStr + "T23:59:59");

    /* ★ Q12: 집계 기준은 실제 결제일 — 효성 CMS는 hyosungPaidDate, 그 외 채널은 createdAt */
    const paidAt = sql`COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt})`;

    // pgProvider 기준 채널별 집계
    let channelRows: { provider: string | null; count: number; amount: number }[] = [];
    try {
      channelRows = await db
        .select({
          provider: donations.pgProvider,
          count: sql<number>`count(*)::int`,
          amount: sql<number>`coalesce(sum(${donations.amount}),0)::int`,
        })
        .from(donations)
        .where(
          and(
            eq(donations.status, "completed"),
            sql`${paidAt} >= ${startDate.toISOString()}`,
            sql`${paidAt} <= ${endDate.toISOString()}`
          )
        )
        .groupBy(donations.pgProvider);
    } catch (err) {
      console.warn("[finance-income] channelRows 집계 실패:", err);
    }

    // 월별 추이 (year·half_year·custom 60일+ 일 때만 — includeMonthly 기준)
    let monthlyTrend: { month: number; amount: number }[] = [];
    if (includeMonthly) {
      try {
        const trendRows = await db
          .select({
            m: sql<number>`extract(month from ${paidAt})::int`,
            amount: sql<number>`coalesce(sum(${donations.amount}),0)::int`,
          })
          .from(donations)
          .where(
            and(
              eq(donations.status, "completed"),
              sql`${paidAt} >= ${startDate.toISOString()}`,
              sql`${paidAt} <= ${endDate.toISOString()}`
            )
          )
          .groupBy(sql`extract(month from ${paidAt})`);
        monthlyTrend = trendRows.map((r) => ({ month: r.m, amount: r.amount }));
      } catch (err) {
        console.warn("[finance-income] monthlyTrend 집계 실패:", err);
      }
    }

    // 후원자 수 + 신규 회원 수
    let donorCount = { activeThisPeriod: 0, newMembers: 0 };
    try {
      const [activeDonors] = await db
        .select({ count: sql<number>`count(distinct ${donations.memberId})::int` })
        .from(donations)
        .where(
          and(
            eq(donations.status, "completed"),
            sql`${paidAt} >= ${startDate.toISOString()}`,
            sql`${paidAt} <= ${endDate.toISOString()}`
          )
        );
      const [newMemberCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(members)
        .where(
          and(
            gte(members.createdAt, startDate),
            lte(members.createdAt, endDate)
          )
        );
      donorCount = {
        activeThisPeriod: activeDonors?.count ?? 0,
        newMembers: newMemberCount?.count ?? 0,
      };
    } catch (err) {
      console.warn("[finance-income] donorCount 집계 실패:", err);
    }

    // 채널 정규화 (toss / hyosung / bank / other)
    const channelMap: Record<string, { count: number; amount: number }> = {
      toss: { count: 0, amount: 0 },
      hyosung: { count: 0, amount: 0 },
      bank: { count: 0, amount: 0 },
      other: { count: 0, amount: 0 },
    };
    let totalAmount = 0;
    let totalCount = 0;
    for (const row of channelRows) {
      const p = (row.provider ?? "").toLowerCase();
      const key = p.includes("toss")
        ? "toss"
        : p.includes("hyosung")
        ? "hyosung"
        : p === "bank"
        ? "bank"
        : "other";
      channelMap[key].count += row.count;
      channelMap[key].amount += row.amount;
      totalAmount += row.amount;
      totalCount += row.count;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          year,
          month,
          period,
          startDate: sdStr,
          endDate: edStr,
          totalAmount,
          totalCount,
          byChannel: channelMap,
          monthlyTrend,
          donorCount,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "수입 집계 조회 실패",
        step: "query",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
