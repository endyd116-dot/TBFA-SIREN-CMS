// netlify/functions/admin-campaign-stats.ts
// ★ Phase M-19-2: 캠페인별 상세 통계
//
// GET /api/admin/campaign-stats?id=N           — 단일 캠페인 통계
// GET /api/admin/campaign-stats?id=N&trend=1   — + 일별 추이 (최근 30일)
// POST /api/admin/campaign-stats               — 캐시 재계산
//   body: { id?: number }  (id 미지정 시 전체 active 캠페인)
//
// 권한: 모든 운영자 조회 가능 / 재계산은 super_admin 또는 donation 담당

import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { db } from "../../db";
import { campaigns, donations, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

function canRecalc(adminMember: any): boolean {
  if (!adminMember) return false;
  if (adminMember.role === "super_admin") return true;
  const cats: string[] = Array.isArray(adminMember.assignedCategories) ? adminMember.assignedCategories : [];
  return cats.includes("all") || cats.includes("donation");
}

/**
 * 단일 캠페인의 통계 재계산 + DB 캐시 갱신
 */
async function recalcOne(campaignId: number): Promise<{
  raisedAmount: number;
  donorCount: number;
  donationCount: number;
}> {
  const result: any = await db.execute(sql`
    SELECT
      COALESCE(SUM(amount), 0)::bigint AS "totalAmount",
      COUNT(DISTINCT COALESCE(member_id, 0))::int AS "uniqueDonors",
      COUNT(*)::int AS "donationCount"
    FROM donations
    WHERE campaign_id = ${campaignId}
      AND status = 'completed'
  `);

  const r: any = result.rows ? result.rows[0] : result[0] || {};
  const raisedAmount = Number(r.totalAmount || 0);
  const donorCount = Number(r.uniqueDonors || 0);
  const donationCount = Number(r.donationCount || 0);

  await db.update(campaigns).set({
    raisedAmount,
    donorCount,
    updatedAt: new Date(),
  } as any).where(eq(campaigns.id, campaignId));

  return { raisedAmount, donorCount, donationCount };
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member: adminMember } = guard.ctx;

  try {
    /* ===== GET: 통계 조회 ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = Number(url.searchParams.get("id"));
      const includeTrend = url.searchParams.get("trend") === "1";

      if (!Number.isFinite(id) || id <= 0) return badRequest("유효하지 않은 캠페인 ID");

      /* 캠페인 조회 */
      const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
      if (!c) return notFound("캠페인을 찾을 수 없습니다");

      /* 핵심 통계 (실시간 집계) */
      const aggResult: any = await db.execute(sql`
        SELECT
          COALESCE(SUM(amount), 0)::bigint AS "totalAmount",
          COUNT(DISTINCT COALESCE(member_id, 0))::int AS "uniqueDonors",
          COUNT(*)::int AS "totalDonations",
          COUNT(*) FILTER (WHERE type = 'regular')::int AS "regularCount",
          COUNT(*) FILTER (WHERE type = 'onetime')::int AS "onetimeCount",
          COALESCE(AVG(amount), 0)::int AS "avgAmount",
          MAX(amount) AS "maxAmount",
          MIN(amount) AS "minAmount",
          MAX(created_at) AS "lastDonationAt"
        FROM donations
        WHERE campaign_id = ${id}
          AND status = 'completed'
      `);
      const agg: any = aggResult.rows ? aggResult.rows[0] : aggResult[0] || {};

      const raisedAmount = Number(agg.totalAmount || 0);
      const donorCount = Number(agg.uniqueDonors || 0);
      const goalAmount = c.goalAmount || 0;
      const progressPercent = goalAmount > 0
        ? Math.min(100, Math.round((raisedAmount / goalAmount) * 100 * 10) / 10)
        : null;

      /* 진행률 분석 */
      let progressStatus: "on_track" | "behind" | "ahead" | "completed" | "no_goal" = "no_goal";
      if (goalAmount > 0) {
        if (raisedAmount >= goalAmount) {
          progressStatus = "completed";
        } else if (c.startDate && c.endDate) {
          const totalMs = new Date(c.endDate).getTime() - new Date(c.startDate).getTime();
          const elapsedMs = Date.now() - new Date(c.startDate).getTime();
          const expectedPercent = totalMs > 0 ? Math.max(0, Math.min(100, (elapsedMs / totalMs) * 100)) : 0;
          const actualPercent = (raisedAmount / goalAmount) * 100;

          if (actualPercent >= expectedPercent + 10) progressStatus = "ahead";
          else if (actualPercent < expectedPercent - 15) progressStatus = "behind";
          else progressStatus = "on_track";
        } else {
          progressStatus = "on_track";
        }
      }

      /* 최근 후원자 5명 */
      const recentDonors = await db
        .select({
          id: donations.id,
          donorName: donations.donorName,
          amount: donations.amount,
          type: donations.type,
          isAnonymous: donations.isAnonymous,
          createdAt: donations.createdAt,
        })
        .from(donations)
        .where(and(eq(donations.campaignId, id), eq(donations.status, "completed")))
        .orderBy(desc(donations.createdAt))
        .limit(5);

      /* TOP 후원자 5명 (금액 합계 기준) */
      const topDonorsRaw: any = await db.execute(sql`
        SELECT
          COALESCE(d.member_id, 0) AS "memberId",
          MAX(d.donor_name) AS "donorName",
          SUM(d.amount)::bigint AS "totalAmount",
          COUNT(*)::int AS "donationCount",
          BOOL_OR(d.is_anonymous) AS "anyAnonymous"
        FROM donations d
        WHERE d.campaign_id = ${id}
          AND d.status = 'completed'
        GROUP BY d.member_id
        ORDER BY SUM(d.amount) DESC
        LIMIT 5
      `);
      const topDonors = (topDonorsRaw.rows || topDonorsRaw || []).map((r: any) => ({
        memberId: r.memberId || null,
        donorName: r.anyAnonymous ? "익명" : (r.donorName || "후원자"),
        totalAmount: Number(r.totalAmount || 0),
        donationCount: r.donationCount || 0,
        isAnonymous: !!r.anyAnonymous,
      }));

      /* 일별 추이 (옵션) */
      let trend: any[] = [];
      if (includeTrend) {
        const trendResult: any = await db.execute(sql`
          SELECT
            DATE(created_at) AS "date",
            COALESCE(SUM(amount), 0)::bigint AS "amount",
            COUNT(*)::int AS "count"
          FROM donations
          WHERE campaign_id = ${id}
            AND status = 'completed'
            AND created_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE(created_at)
          ORDER BY DATE(created_at) ASC
        `);
        trend = (trendResult.rows || trendResult || []).map((r: any) => ({
          date: r.date,
          amount: Number(r.amount || 0),
          count: r.count || 0,
        }));
      }

      /* 캐시값과 실제값 차이 (관리자 안내용) */
      const cacheStale = c.raisedAmount !== raisedAmount || c.donorCount !== donorCount;

      return ok({
        campaign: {
          id: c.id,
          slug: c.slug,
          type: c.type,
          title: c.title,
          status: c.status,
          goalAmount,
          startDate: c.startDate,
          endDate: c.endDate,
          views: c.views,
          isPublished: c.isPublished,
        },
        stats: {
          raisedAmount,
          goalAmount,
          progressPercent,
          progressStatus,
          donorCount,
          totalDonations: Number(agg.totalDonations || 0),
          regularCount: Number(agg.regularCount || 0),
          onetimeCount: Number(agg.onetimeCount || 0),
          avgAmount: Number(agg.avgAmount || 0),
          maxAmount: Number(agg.maxAmount || 0),
          minAmount: Number(agg.minAmount || 0),
          lastDonationAt: agg.lastDonationAt,
        },
        recentDonors: recentDonors.map((d: any) => ({
          ...d,
          donorName: d.isAnonymous ? "익명" : d.donorName,
        })),
        topDonors,
        trend,
        cache: {
          stale: cacheStale,
          cachedRaised: c.raisedAmount,
          cachedDonors: c.donorCount,
        },
      });
    }

    /* ===== POST: 캐시 재계산 ===== */
    if (req.method === "POST") {
      if (!canRecalc(adminMember)) {
        return forbidden("재계산 권한이 없습니다");
      }

      const body = await parseJson(req);
      const targetId = body?.id ? Number(body.id) : null;

      let processed: any[] = [];

      if (targetId && Number.isFinite(targetId)) {
        /* 단일 캠페인 재계산 */
        const [c] = await db.select().from(campaigns).where(eq(campaigns.id, targetId)).limit(1);
        if (!c) return notFound("캠페인을 찾을 수 없습니다");

        const result = await recalcOne(targetId);
        processed.push({ id: targetId, slug: c.slug, ...result });
      } else {
        /* 전체 active 캠페인 재계산 */
        const activeCampaigns = await db
          .select({ id: campaigns.id, slug: campaigns.slug })
          .from(campaigns)
          .where(eq(campaigns.status, "active"));

        for (const c of activeCampaigns) {
          try {
            const result = await recalcOne(c.id);
            processed.push({ id: c.id, slug: c.slug, ...result });
          } catch (e) {
            console.error(`[campaign-stats] 재계산 실패 id=${c.id}:`, e);
          }
        }
      }

      try {
        await logAdminAction(req, admin.uid, admin.name, "campaign_stats_recalc", {
          target: targetId ? `C-${targetId}` : "all_active",
          detail: { processedCount: processed.length },
        });
      } catch (_) {}

      return ok({
        processed,
        count: processed.length,
      }, `${processed.length}개 캠페인의 통계가 재계산되었습니다`);
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-campaign-stats]", err);
    return serverError("캠페인 통계 처리 중 오류", err?.message);
  }
};

export const config = { path: "/api/admin/campaign-stats" };