// lib/campaign-stats.ts
// US-044: 캠페인 모금현황(raised_amount·donor_count) 재계산 공용 헬퍼.
//   기존엔 admin-campaign-stats 의 수동 재계산(POST)에서만 갱신되어, 후원 완료 직후
//   캠페인 상세의 진행률·모금액·후원자수가 옛 값으로 멈춰 있었다(부진 감지 크론도 오판).
//   후원 완료 시점(KICC 승인·계좌이체 통과 등)에서 fire-and-forget 으로 호출한다.
//   집계식은 admin-campaign-stats.recalcOne 과 동일(회원=distinct member_id, 비회원=건당 1명).
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { campaigns } from "../db/schema";

export async function recalcCampaignStats(campaignId: number): Promise<{
  raisedAmount: number;
  donorCount: number;
  donationCount: number;
}> {
  const result: any = await db.execute(sql`
    SELECT
      COALESCE(SUM(amount), 0)::bigint AS "totalAmount",
      (COUNT(DISTINCT member_id) FILTER (WHERE member_id IS NOT NULL)
        + COUNT(*) FILTER (WHERE member_id IS NULL))::int AS "uniqueDonors",
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

/** 후원 완료 후 안전 호출용 — campaignId 없으면 noop, 실패해도 throw 안 함(fire-and-forget). */
export async function recalcCampaignStatsSafe(campaignId: number | null | undefined): Promise<void> {
  if (!campaignId || !Number.isFinite(Number(campaignId))) return;
  try {
    await recalcCampaignStats(Number(campaignId));
  } catch (e) {
    console.warn("[recalcCampaignStatsSafe] 캠페인 현황 갱신 실패 campaignId=" + campaignId, e);
  }
}
