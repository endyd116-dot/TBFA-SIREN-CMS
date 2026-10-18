/**
 * lib/donor-status.ts — 후원 회원 단계 평가 (Phase 2 · 2026-10-18 전면 개정)
 *
 * 저장 컬럼: members.donor_type / donor_channels / prospect_subtype / donor_evaluated_at
 * 규칙의 단일 출처는 lib/donor-stage.ts (잠재 → 예비·일시/해지 → 정기 · 수동 지정 우선권 · 이력)
 *
 *   정기(regular)            : 활성 카드 빌링키 또는 효성 약정 active
 *   예비·해지(prospect/cancelled): 카드 해지 이력·효성 해지/정지/만료 + 낸 적 있고 마지막 납부가 LAPSE_MONTHS 안
 *   잠재(none + 잠재 행)      : 해지됐는데 한 번도 낸 적 없거나 LAPSE_MONTHS 넘게 후원이 없음(★ 자동 역방향) · 잠재 행만 연결된 회원
 *   예비·일시(prospect/onetime): 완료된 일시 후원 1건+
 *   회원(none)               : 위 어느 것도 아님(후원 단계 아님)
 *
 * 수동 지정(운영자 단계 이동)은 donor_stage_events에 남고, 그 당시 자동 판정(auto_baseline)이 바뀔 때까지 유지된다.
 * 단계가 바뀌면(자동·수동) 이력 1행. 표가 없으면(마이그 전) 이력·수동 지정 없이 자동 판정만.
 *
 * 사용처:
 *   - 후크: billing-approve / cron-kicc-billing / billing-cancel / admin-donation-confirm / 효성 수납 / 일시후원 (fire-and-forget)
 *   - cron: cron-donor-status-sync (매일 KST 03:00 일괄 재평가, bulk SQL — 같은 규칙을 CTE로 전원 적용)
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { safeLinkPotentialDonors } from "./potential-donor-link";
import {
  type DonorStage, STAGE_LABEL, LAPSE_MONTHS,
  SIGNALS_SELECT_SQL, AUTO_STAGE_CASE_SQL, CHANNELS_CASE_SQL, CURRENT_STAGE_CASE_SQL,
  computeAutoStage, getActiveOverride, releaseOverride, recordStageEvent, applyStageToMember,
  ensurePotentialRowForMember, stageEventsTableExists,
} from "./donor-stage";

export type DonorChannel = "toss" | "hyosung";
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

/* =========================================================
   1. 단일 회원 재평가 (후크용)
   ========================================================= */

export async function reevaluateDonorType(memberId: number): Promise<void> {
  if (!Number.isInteger(memberId) || memberId <= 0) return;

  const auto = await computeAutoStage(memberId);
  if (!auto) return;

  /* 수동 지정 우선권 — 자동 판정이 지정 당시와 같으면 유지, 달라졌으면(실데이터 변화) 해제 */
  let finalStage: DonorStage = auto.stage;
  let note: string | null = null;
  const ov = await getActiveOverride(memberId);
  if (ov) {
    if (ov.autoBaseline === auto.stage) {
      finalStage = ov.toStage;
    } else {
      await releaseOverride(ov.id, `auto:${auto.stage}`);
      note = `실데이터 변화로 수동 지정 해제 (${STAGE_LABEL[ov.toStage]} → ${STAGE_LABEL[auto.stage]})`;
    }
  }

  /* 잠재로 내려가면 잠재 화면에 보이도록 잠재 행 보장 */
  if (finalStage === "potential" && !auto.signals.hasPotentialRow) {
    const neverPaid = auto.signals.paidCount === 0 && auto.signals.hyosungReceived === 0;
    await ensurePotentialRowForMember(memberId, {
      eventName: "자동 전환(잠재)", entryPath: "auto_stage",
      memo: `[자동] ${neverPaid ? "후원 이력 없이 해지되어" : `${LAPSE_MONTHS}개월 넘게 후원이 없어`} 잠재로 이동`,
    }).catch((e: any) => console.warn("[donor-status] 잠재 행 생성 실패", e?.message || e));
  }

  await applyStageToMember(memberId, finalStage, auto.channels);

  if (finalStage !== auto.currentStage) {
    await recordStageEvent({
      memberId, fromStage: auto.currentStage, toStage: finalStage, source: "auto",
      reason: note || (ov ? "수동 지정 유지(자동 재평가)" : "자동 재평가"),
    });
  }

  /* 2026-10-18: 전환 순간 잠재 후원자 자동 연결(전화·이메일 일치) — 실패해도 재평가에 영향 0 */
  await safeLinkPotentialDonors(memberId, `reevaluate:${finalStage}`);
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
  eventsRecorded?: number;
  overridesReleased?: number;
  potentialRowsCreated?: number;
}

/** 단건과 같은 규칙을 전원에 적용하는 공용 CTE(수동 지정 표 유무에 따라 분기) */
function bulkCte(withOverride: boolean): string {
  return `
    WITH sig AS (${SIGNALS_SELECT_SQL}),
    auto AS (
      SELECT s.id, ${AUTO_STAGE_CASE_SQL} AS stage, ${CHANNELS_CASE_SQL} AS channels, ${CURRENT_STAGE_CASE_SQL} AS cur_stage
      FROM sig s
    ),
    ${withOverride ? `ov AS (
      SELECT DISTINCT ON (member_id) member_id, id AS event_id, to_stage, auto_baseline
        FROM donor_stage_events
       WHERE source = 'manual' AND is_override = TRUE AND released_at IS NULL
       ORDER BY member_id, id DESC
    ),` : ``}
    fin0 AS (
      SELECT a.id, a.cur_stage, a.channels,
        ${withOverride ? `CASE WHEN ov.member_id IS NOT NULL AND ov.auto_baseline = a.stage THEN ov.to_stage ELSE a.stage END` : `a.stage`} AS stage,
        ${withOverride ? `(ov.member_id IS NOT NULL AND ov.auto_baseline <> a.stage)` : `FALSE`} AS release_ov,
        ${withOverride ? `ov.event_id` : `NULL::int`} AS event_id
      FROM auto a ${withOverride ? `LEFT JOIN ov ON ov.member_id = a.id` : ``}
    ),
    fin AS (
      SELECT f.*,
        CASE f.stage WHEN 'regular' THEN 'regular' WHEN 'prospect_onetime' THEN 'prospect' WHEN 'prospect_cancelled' THEN 'prospect' ELSE 'none' END AS donor_type,
        CASE f.stage WHEN 'prospect_onetime' THEN 'onetime' WHEN 'prospect_cancelled' THEN 'cancelled' ELSE NULL END AS prospect_subtype
      FROM fin0 f
    )`;
}

export async function reevaluateAllDonorTypes(): Promise<BulkReevaluateSummary> {
  const startedAt = Date.now();
  let hasEvents = false;
  try { hasEvents = await stageEventsTableExists(); } catch { hasEvents = false; }

  let eventsRecorded = 0;
  let overridesReleased = 0;

  if (hasEvents) {
    /* S1. 단계가 바뀌는 회원의 이력(수동 지정이 풀리는 경우 사유 포함) — 해제·갱신 전에 기록 */
    const ev = rowsOf(await db.execute(sql.raw(`${bulkCte(true)}
      INSERT INTO donor_stage_events (member_id, from_stage, to_stage, source, reason, created_at)
      SELECT f.id, f.cur_stage, f.stage, 'auto',
             CASE WHEN f.release_ov THEN '실데이터 변화로 수동 지정 해제(일괄 재평가)' ELSE '일괄 재평가' END, NOW()
        FROM fin f WHERE f.stage <> f.cur_stage
      RETURNING id`)));
    eventsRecorded = ev.length;

    /* S2. 실데이터가 바뀐 수동 지정 해제 */
    const rel = rowsOf(await db.execute(sql.raw(`${bulkCte(true)}
      UPDATE donor_stage_events e SET is_override = FALSE, released_at = NOW(), release_reason = 'auto:bulk'
        FROM fin f WHERE f.release_ov AND e.id = f.event_id
      RETURNING e.id`)));
    overridesReleased = rel.length;
  }

  /* S3. 잠재로 내려가는 회원의 잠재 행 보장(잠재 화면 노출) */
  const made = rowsOf(await db.execute(sql.raw(`${bulkCte(hasEvents)}
    INSERT INTO potential_donors (name, phone, email, event_name, entry_path, participated_at, memo, linked_member_id, linked_at, created_at, updated_at)
    SELECT m.name, m.phone,
           CASE WHEN COALESCE(m.email, '') ILIKE '%@noemail.%' OR COALESCE(m.email, '') ILIKE '%@lantern.invalid' THEN NULL ELSE m.email END,
           '자동 전환(잠재)', 'auto_stage', NOW(),
           '[자동] 후원 이력 없이 해지되었거나 ${LAPSE_MONTHS}개월 넘게 후원이 없어 잠재로 이동(일괄 재평가)', m.id, NOW(), NOW(), NOW()
      FROM fin f JOIN members m ON m.id = f.id
     WHERE f.stage = 'potential'
       AND NOT EXISTS (SELECT 1 FROM potential_donors pd WHERE pd.linked_member_id = m.id)
    RETURNING id`)));

  /* S4. members 적용(바뀐 행만) */
  await db.execute(sql.raw(`${bulkCte(hasEvents)}
    UPDATE members m
       SET donor_type = f.donor_type,
           prospect_subtype = f.prospect_subtype,
           donor_channels = f.channels,
           donor_evaluated_at = NOW(),
           updated_at = NOW()
      FROM fin f
     WHERE m.id = f.id
       AND (
         m.donor_type IS DISTINCT FROM f.donor_type
         OR m.prospect_subtype IS DISTINCT FROM f.prospect_subtype
         OR m.donor_channels IS DISTINCT FROM f.channels
         OR m.donor_evaluated_at IS NULL
       )`));

  /* 분포 집계 */
  const row = rowsOf(await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE donor_type = 'regular')::int AS regular_count,
      COUNT(*) FILTER (WHERE donor_type = 'prospect' AND prospect_subtype = 'onetime')::int AS onetime_count,
      COUNT(*) FILTER (WHERE donor_type = 'prospect' AND prospect_subtype = 'cancelled')::int AS cancelled_count,
      COUNT(*) FILTER (WHERE donor_type = 'none')::int AS none_count
    FROM members
  `))[0] || {};

  return {
    totalEvaluated: Number(row.total) || 0,
    regularCount: Number(row.regular_count) || 0,
    prospectOnetimeCount: Number(row.onetime_count) || 0,
    prospectCancelledCount: Number(row.cancelled_count) || 0,
    noneCount: Number(row.none_count) || 0,
    durationMs: Date.now() - startedAt,
    eventsRecorded,
    overridesReleased,
    potentialRowsCreated: made.length,
  };
}
