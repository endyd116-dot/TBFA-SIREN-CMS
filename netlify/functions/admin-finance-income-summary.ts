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

    /* paid_at 기준 집계 — paid_at 없는 구형 레코드는 효성은 hyosung_paid_date, 그 외는 created_at 폴백 */
    const paidAt = sql`COALESCE(${donations.paidAt}, ${donations.hyosungPaidDate}, ${donations.createdAt})`;

    // pgProvider + type 기준 채널별 집계
    // ★ 버그픽스2 #7·#8: 기존엔 provider 만으로 집계해 토스 정기(CMS)·토스 일시가
    //   한 칸에 뭉쳐 4채널(효성정기·CMS정기·일시직접계좌·일시토스) 분해가 불가능했음.
    //   provider 와 함께 type(regular/onetime) 도 묶어 4채널 분해 가능하게 한다.
    let channelRows: { provider: string | null; type: string | null; count: number; amount: number }[] = [];
    try {
      channelRows = await db
        .select({
          provider: donations.pgProvider,
          type: donations.type,
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
        .groupBy(donations.pgProvider, donations.type);
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
    // ★ 버그픽스2 #7·#8: 4채널 분해 — 효성정기·CMS정기(토스 정기)·일시토스·일시직접계좌.
    //   효성은 정기/일시 구분 없이 hyosung 으로, 그 외는 정기=토스빌링(CMS), 일시=토스/계좌로 분해.
    const fourChannel = {
      hyosungRegular: { count: 0, amount: 0 },   // 효성 CMS+ 정기
      cmsRegular:     { count: 0, amount: 0 },   // 토스 빌링 정기 (CMS 정기)
      onetimeToss:    { count: 0, amount: 0 },   // 일시 — 토스 결제
      onetimeBank:    { count: 0, amount: 0 },   // 일시 — 직접 계좌이체
    };
    let totalAmount = 0;
    let totalCount = 0;
    for (const row of channelRows) {
      const p = (row.provider ?? "").toLowerCase();
      const isRegular = row.type === "regular";
      /* ★ 2026-05-16 fix: IBK 통과 'ibk_bank'·신청 'manual'·옛 'bank' 모두 계좌이체 채널로 정규화.
         이전엔 'ibk_bank'가 'bank' 와 정확히 같지 않아 모두 'other'로 떨어졌음 → 수입 현황에서
         IBK 입금이 '기타'로 잡히던 회귀. */
      const isBankLike = p === "bank" || p.includes("ibk") || p === "manual";
      const key = p.includes("toss")
        ? "toss"
        : p.includes("hyosung")
        ? "hyosung"
        : isBankLike
        ? "bank"
        : "other";
      channelMap[key].count += row.count;
      channelMap[key].amount += row.amount;

      // 4채널 분해
      let fcKey: keyof typeof fourChannel;
      if (key === "hyosung") {
        fcKey = "hyosungRegular";
      } else if (isRegular) {
        fcKey = "cmsRegular";
      } else if (key === "toss") {
        fcKey = "onetimeToss";
      } else {
        fcKey = "onetimeBank"; // bank / other 일시 → 직접 계좌이체로 집계
      }
      fourChannel[fcKey].count += row.count;
      fourChannel[fcKey].amount += row.amount;

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
          // ★ 버그픽스2 #7: 금월 결제금액 4채널 분해 + 합계 (프론트가 그대로 사용)
          fourChannel,
          fourChannelTotal:
            fourChannel.hyosungRegular.amount +
            fourChannel.cmsRegular.amount +
            fourChannel.onetimeToss.amount +
            fourChannel.onetimeBank.amount,
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
