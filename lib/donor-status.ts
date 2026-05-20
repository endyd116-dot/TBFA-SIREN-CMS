/**
 * lib/donor-status.ts — Phase 2 (마일스톤 #16 단계 C)
 *
 * 후원 회원 분류(`members.donor_type / donor_channels / prospect_subtype / donor_evaluated_at`) 평가 로직.
 *
 * 식별 기준 (마일스톤 §3.2 + DESIGN_PHASE2.md §5.2):
 *   정기(regular):
 *     - billing_keys.is_active = true → channels에 'toss'
 *     - members.hyosung_contract_status = 'active' → channels에 'hyosung'
 *   잠재(prospect):
 *     - 정기 중단 신호 (billing_keys.deactivated_at 존재 OR hyosung_contract_status IN
 *       ('cancelled','suspended','expired','terminated')) → subtype = 'cancelled'
 *     - donations(type='onetime', status='completed') 1건+ → subtype = 'onetime'
 *     - 둘 다면 'cancelled' 우선
 *   비후원(none): 위 어느 것도 아님
 *
 * 사용처:
 *   - 후크: billing-approve / cron-kicc-billing / billing-cancel / admin-donation-confirm
 *           (실패해도 메인 트랜잭션 영향 0 — fire-and-forget)
 *   - cron: cron-donor-status-sync (매일 KST 03:00 일괄 재평가, bulk SQL)
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

export type DonorChannel = "toss" | "hyosung";

const CANCELLED_HYOSUNG_STATUSES = ["cancelled", "suspended", "expired", "terminated"];

/* =========================================================
   1. 단일 회원 재평가 (후크용)
   ========================================================= */

export async function reevaluateDonorType(memberId: number): Promise<void> {
  if (!Number.isInteger(memberId) || memberId <= 0) return;

  const result: any = await db.execute(sql`
    SELECT
      m.hyosung_contract_status,
      (SELECT COUNT(*)::int FROM billing_keys bk
        WHERE bk.member_id = m.id AND bk.is_active = true) AS toss_active_count,
      (SELECT COUNT(*)::int FROM billing_keys bk
        WHERE bk.member_id = m.id AND bk.deactivated_at IS NOT NULL) AS toss_deactivated_count,
      (SELECT COUNT(*)::int FROM donations d
        WHERE d.member_id = m.id AND d.type = 'onetime' AND d.status = 'completed') AS onetime_count
    FROM members m
    WHERE m.id = ${memberId}
    LIMIT 1
  `);

  const row = (Array.isArray(result) ? result[0] : (result as any).rows?.[0]) as
    | {
        hyosung_contract_status: string | null;
        toss_active_count: number;
        toss_deactivated_count: number;
        onetime_count: number;
      }
    | undefined;

  if (!row) return;

  const tossActive = Number(row.toss_active_count) > 0;
  const hyosungStatus = (row.hyosung_contract_status || "").toLowerCase();
  const hyosungActive = hyosungStatus === "active";
  const tossEverDeactivated = Number(row.toss_deactivated_count) > 0;
  const hyosungCancelled = CANCELLED_HYOSUNG_STATUSES.includes(hyosungStatus);
  const onetimeCount = Number(row.onetime_count);

  const channels: DonorChannel[] = [];
  if (tossActive) channels.push("toss");
  if (hyosungActive) channels.push("hyosung");

  let donorType: "regular" | "prospect" | "none";
  let prospectSubtype: "onetime" | "cancelled" | null = null;

  if (channels.length > 0) {
    donorType = "regular";
    prospectSubtype = null;
  } else if (tossEverDeactivated || hyosungCancelled) {
    donorType = "prospect";
    prospectSubtype = "cancelled";
  } else if (onetimeCount > 0) {
    donorType = "prospect";
    prospectSubtype = "onetime";
  } else {
    donorType = "none";
    prospectSubtype = null;
  }

  await db.execute(sql`
    UPDATE members
    SET donor_type = ${donorType},
        donor_channels = ${JSON.stringify(channels)}::jsonb,
        prospect_subtype = ${prospectSubtype},
        donor_evaluated_at = NOW(),
        updated_at = NOW()
    WHERE id = ${memberId}
  `);
}

/* =========================================================
   2. fire-and-forget 래퍼 — 후크 호출부 단순화
   ========================================================= */

export async function safeReevaluate(memberId: number | null | undefined, source: string): Promise<void> {
  if (!memberId) return;
  try {
    await reevaluateDonorType(memberId);
  } catch (e: any) {
    console.warn(`[donor-status] ${source} 재평가 실패 — member#${memberId}`, e?.message || e);
  }
}

/* =========================================================
   3. 전체 회원 일괄 재평가 (cron-donor-status-sync용 — bulk SQL)
   ========================================================= */

export interface BulkReevaluateSummary {
  totalEvaluated: number;
  regularCount: number;
  prospectOnetimeCount: number;
  prospectCancelledCount: number;
  noneCount: number;
  durationMs: number;
}

export async function reevaluateAllDonorTypes(): Promise<BulkReevaluateSummary> {
  const startedAt = Date.now();

  /* 모든 회원 분류를 단일 SQL로 계산 + UPDATE
   * (정기 우선, 그 다음 cancelled 우선, 그 다음 onetime, 나머지 none)
   */
  await db.execute(sql`
    WITH member_signals AS (
      SELECT
        m.id,
        m.hyosung_contract_status,
        (SELECT COUNT(*)::int FROM billing_keys bk
          WHERE bk.member_id = m.id AND bk.is_active = true) AS toss_active,
        (SELECT COUNT(*)::int FROM billing_keys bk
          WHERE bk.member_id = m.id AND bk.deactivated_at IS NOT NULL) AS toss_deact,
        (SELECT COUNT(*)::int FROM donations d
          WHERE d.member_id = m.id AND d.type = 'onetime' AND d.status = 'completed') AS onetime_cnt
      FROM members m
    ),
    classified AS (
      SELECT
        s.id,
        CASE
          WHEN s.toss_active > 0 OR LOWER(COALESCE(s.hyosung_contract_status,'')) = 'active'
            THEN 'regular'
          WHEN s.toss_deact > 0
               OR LOWER(COALESCE(s.hyosung_contract_status,'')) IN ('cancelled','suspended','expired','terminated')
            THEN 'prospect'
          WHEN s.onetime_cnt > 0
            THEN 'prospect'
          ELSE 'none'
        END AS donor_type,
        (CASE
          WHEN s.toss_active > 0 AND LOWER(COALESCE(s.hyosung_contract_status,'')) = 'active'
            THEN '["toss","hyosung"]'::jsonb
          WHEN s.toss_active > 0
            THEN '["toss"]'::jsonb
          WHEN LOWER(COALESCE(s.hyosung_contract_status,'')) = 'active'
            THEN '["hyosung"]'::jsonb
          ELSE '[]'::jsonb
        END) AS donor_channels,
        (CASE
          WHEN s.toss_active > 0 OR LOWER(COALESCE(s.hyosung_contract_status,'')) = 'active'
            THEN NULL
          WHEN s.toss_deact > 0
               OR LOWER(COALESCE(s.hyosung_contract_status,'')) IN ('cancelled','suspended','expired','terminated')
            THEN 'cancelled'
          WHEN s.onetime_cnt > 0
            THEN 'onetime'
          ELSE NULL
        END) AS prospect_subtype
      FROM member_signals s
    )
    UPDATE members m
    SET donor_type = c.donor_type,
        donor_channels = c.donor_channels,
        prospect_subtype = c.prospect_subtype,
        donor_evaluated_at = NOW(),
        updated_at = NOW()
    FROM classified c
    WHERE m.id = c.id
      AND (
        m.donor_type IS DISTINCT FROM c.donor_type
        OR m.donor_channels IS DISTINCT FROM c.donor_channels
        OR m.prospect_subtype IS DISTINCT FROM c.prospect_subtype
        OR m.donor_evaluated_at IS NULL
      )
  `);

  /* 분포 집계 */
  const distRes: any = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE donor_type = 'regular')::int AS regular_count,
      COUNT(*) FILTER (WHERE donor_type = 'prospect' AND prospect_subtype = 'onetime')::int AS onetime_count,
      COUNT(*) FILTER (WHERE donor_type = 'prospect' AND prospect_subtype = 'cancelled')::int AS cancelled_count,
      COUNT(*) FILTER (WHERE donor_type = 'none')::int AS none_count
    FROM members
  `);

  const row = (Array.isArray(distRes) ? distRes[0] : (distRes as any).rows?.[0]) || {};

  return {
    totalEvaluated: Number(row.total) || 0,
    regularCount: Number(row.regular_count) || 0,
    prospectOnetimeCount: Number(row.onetime_count) || 0,
    prospectCancelledCount: Number(row.cancelled_count) || 0,
    noneCount: Number(row.none_count) || 0,
    durationMs: Date.now() - startedAt,
  };
}
