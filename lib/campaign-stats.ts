// lib/campaign-stats.ts
// US-044: 캠페인 모금현황(raised_amount·donor_count) 재계산 공용 헬퍼.
//   기존엔 admin-campaign-stats 의 수동 재계산(POST)에서만 갱신되어, 후원 완료 직후
//   캠페인 상세의 진행률·모금액·후원자수가 옛 값으로 멈춰 있었다(부진 감지 크론도 오판).
//   후원 완료 시점(KICC 승인·계좌이체 통과 등)에서 fire-and-forget 으로 호출한다.
//   집계식은 admin-campaign-stats.recalcOne 과 동일(회원=distinct member_id, 비회원=건당 1명).
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { campaigns } from "../db/schema";
import { maskName } from "./lantern";

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

/* ------------------------------------------------------------------ */
/* ★ 2026-09-06 「등불의 기적」 공개 실값 — 한 출처                          */
/*   랜딩(withwork)이 읽는 /api/campaign-stats 와 캠페인 페이지 서버 렌더가    */
/*   같은 함수를 쓴다 → 랜딩 게이지와 캠페인 페이지 숫자가 항상 같다.           */
/*   응답 키 이름은 AutoMarketing 과 계약된 그대로(S6-a + 요청 ⑬ additive).    */
/* ------------------------------------------------------------------ */

export interface CampaignPublicStats {
  /** 후원(정기+일시)한 사람 수 — 회원은 중복 제거, 비회원은 건당 1명 */
  members: number;
  /** 정기(월) 후원회원 수 */
  monthly: number;
  /** 최근 5명 — 공개 동의(S11)한 후원만 */
  recent: Array<{ name: string; school?: string; note?: string; at: string }>;
  /** 학교명/소속 집계(S12) */
  bySchool: Array<{ school: string; count: number }>;
  /** ⑬ 완료 후원 합계(원) — 취소·환불 제외 */
  raisedKrw: number;
  /** ⑬ 캠페인 목표(원) */
  goalKrw: number;
  /** ⑬ 최근 30명 — 공개 동의면 마스킹 이름, 아니면 «익명» · 정기는 월 금액 */
  donors: Array<{ name: string; amountKrw: number; monthly: boolean; at: string }>;
  /** ⑬ 집계 시각 */
  raisedAsOf: string;
}

function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

/** 캠페인 하나의 공개 실값을 집계한다. 한 쿼리가 실패해도 나머지는 살린다(빈값). */
export async function computeCampaignPublicStats(campaign: { id: number; goalAmount?: number | null }): Promise<CampaignPublicStats> {
  const id = Number(campaign.id);
  const out: CampaignPublicStats = {
    members: 0,
    monthly: 0,
    recent: [],
    bySchool: [],
    raisedKrw: 0,
    goalKrw: Number(campaign.goalAmount || 0),
    donors: [],
    raisedAsOf: new Date().toISOString(),
  };

  /* 1) 인원·합계 — 회원 중복 제거·비회원 건당 1명 */
  const q1 = db.execute(sql`
    SELECT
      COUNT(DISTINCT COALESCE(member_id::text, 'g' || id::text))::int AS members,
      COUNT(DISTINCT COALESCE(member_id::text, 'g' || id::text))
        FILTER (WHERE type = 'regular')::int AS monthly,
      COALESCE(SUM(amount), 0)::bigint AS raised
    FROM donations
    WHERE campaign_id = ${id} AND status = 'completed'
  `).then((res: any) => {
    const r = rowsOf(res)[0] || {};
    out.members = Number(r.members || 0);
    out.monthly = Number(r.monthly || 0);
    out.raisedKrw = Number(r.raised || 0);
  }).catch((e: any) => console.warn("[campaign-stats] 인원 집계 실패:", e?.message));

  /* 2) 최근 등불 — 공개 동의자만 */
  const q2 = db.execute(sql`
    SELECT d.donor_name AS name, d.donor_note AS note, d.is_anonymous AS anon,
           COALESCE(d.paid_at, d.created_at) AS at, m.school_name AS school
    FROM donations d
    LEFT JOIN members m ON m.id = d.member_id
    WHERE d.campaign_id = ${id} AND d.status = 'completed' AND d.public_consent = TRUE
    ORDER BY COALESCE(d.paid_at, d.created_at) DESC
    LIMIT 5
  `).then((res: any) => {
    out.recent = rowsOf(res).map((r: any) => {
      const item: any = {
        name: r.anon ? "익명" : maskName(r.name),
        at: new Date(r.at).toISOString(),
      };
      const school = String(r.school || "").trim();
      const note = String(r.note || "").trim();
      if (school) item.school = school;
      if (note) item.note = note.slice(0, 60);
      return item;
    });
  }).catch((e: any) => console.warn("[campaign-stats] recent 집계 실패:", e?.message));

  /* 3) 학교 단위 — 학교명 있는 회원만 */
  const q3 = db.execute(sql`
    SELECT m.school_name AS school, COUNT(DISTINCT d.member_id)::int AS count
    FROM donations d
    JOIN members m ON m.id = d.member_id
    WHERE d.campaign_id = ${id} AND d.status = 'completed'
      AND m.school_name IS NOT NULL AND btrim(m.school_name) <> ''
    GROUP BY m.school_name
    ORDER BY count DESC, school ASC
    LIMIT 50
  `).then((res: any) => {
    out.bySchool = rowsOf(res).map((r: any) => ({ school: String(r.school).trim(), count: Number(r.count || 0) }));
  }).catch((e: any) => console.warn("[campaign-stats] bySchool 집계 실패:", e?.message));

  /* 4) ⑬ 후원자 명단 30명 — 이름은 공개 동의 + 익명 아님일 때만 마스킹 표기 */
  const q4 = db.execute(sql`
    SELECT donor_name AS name, amount, type, is_anonymous AS anon, public_consent AS consent,
           COALESCE(paid_at, created_at) AS at
    FROM donations
    WHERE campaign_id = ${id} AND status = 'completed'
    ORDER BY COALESCE(paid_at, created_at) DESC
    LIMIT 30
  `).then((res: any) => {
    out.donors = rowsOf(res).map((r: any) => ({
      name: r.consent === true && !r.anon ? maskName(r.name) : "익명",
      amountKrw: Number(r.amount || 0),
      monthly: String(r.type) === "regular",
      at: new Date(r.at).toISOString(),
    }));
  }).catch((e: any) => console.warn("[campaign-stats] donors 집계 실패:", e?.message));

  await Promise.all([q1, q2, q3, q4]);
  return out;
}
