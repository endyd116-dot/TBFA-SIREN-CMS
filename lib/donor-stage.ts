// lib/donor-stage.ts
// 2026-10-18: 후원자 «단계» 단일 출처 — 잠재 → 예비(일시/해지) → 정기 · 수동 지정(우선권) · 이력(donor_stage_events)
//
// 단계(stage)와 저장 위치
//   potential          잠재            members.donor_type='none'  + potential_donors 행이 회원에 연결돼 있음(잠재 화면에 보임)
//   prospect_onetime   예비·일시 후원  donor_type='prospect', prospect_subtype='onetime'
//   prospect_cancelled 예비·해지       donor_type='prospect', prospect_subtype='cancelled'
//   regular            정기 후원자     donor_type='regular'
//   member             회원(미후원)    donor_type='none' + 잠재 행 없음 (후원 단계가 아닌 일반·유족 회원 등)
//
// 자동 판정(computeAutoStage) 규칙 — 실데이터만 본다
//   ① 활성 카드 빌링키 또는 효성 약정 active → regular
//   ② 카드 해지 이력 또는 효성 해지/정지/만료 →
//        한 번이라도 완료 후원·효성 수납이 있고 마지막 납부가 LAPSE_MONTHS 안이면 prospect_cancelled,
//        한 번도 낸 적 없거나 LAPSE_MONTHS 넘게 후원이 없으면 potential  (★ 정기→잠재 자동 역방향)
//   ③ 완료된 일시 후원이 있으면 prospect_onetime
//   ④ 그 외: 잠재 행이 연결돼 있으면 potential, 없으면 member
//
// 수동 지정(override) — 운영자가 단계를 직접 옮기면(donor_stage_events source='manual', is_override=true)
//   그 시점의 자동 판정(auto_baseline)을 함께 적는다. 재평가 때 자동 판정이 baseline과 같으면 수동 지정을 유지하고,
//   달라지면(= 실데이터가 바뀜: 실제 약정·해지·후원 발생) 수동 지정을 해제하고 자동 판정을 따른다. 모든 변화는 이력에 남는다.
// 표가 아직 없으면(마이그 전) 이력·수동 지정 없이 자동 판정만 동작한다(fail-open·예외 없음).
import { sql } from "drizzle-orm";
import { db } from "../db";

export type DonorStage = "potential" | "prospect_onetime" | "prospect_cancelled" | "regular" | "member";
export const STAGE_LABEL: Record<DonorStage, string> = {
  potential: "잠재", prospect_onetime: "예비 · 일시 후원", prospect_cancelled: "예비 · 해지", regular: "정기 후원자", member: "회원(미후원)",
};
/** 운영자가 수동으로 고를 수 있는 단계 */
export const MANUAL_STAGES: DonorStage[] = ["potential", "prospect_onetime", "prospect_cancelled", "regular"];
/** 해지 뒤 이 개월수 넘게 후원이 없으면 예비(해지) → 잠재로 자동 이동 */
export const LAPSE_MONTHS = 24;

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];
const missingTable = (e: any) => /relation "donor_stage_events" does not exist/i.test(String(e?.message || e));

export function isDonorStage(v: unknown): v is DonorStage {
  return v === "potential" || v === "prospect_onetime" || v === "prospect_cancelled" || v === "regular" || v === "member";
}

/** members 행 → 단계 */
export function stageFromMemberRow(donorType: string | null | undefined, prospectSubtype: string | null | undefined, hasPotentialRow: boolean): DonorStage {
  if (donorType === "regular") return "regular";
  if (donorType === "prospect") return prospectSubtype === "cancelled" ? "prospect_cancelled" : "prospect_onetime";
  return hasPotentialRow ? "potential" : "member";
}

/** 단계 → members 컬럼 값 */
export function stageToColumns(stage: DonorStage): { donorType: "regular" | "prospect" | "none"; prospectSubtype: "onetime" | "cancelled" | null } {
  if (stage === "regular") return { donorType: "regular", prospectSubtype: null };
  if (stage === "prospect_onetime") return { donorType: "prospect", prospectSubtype: "onetime" };
  if (stage === "prospect_cancelled") return { donorType: "prospect", prospectSubtype: "cancelled" };
  return { donorType: "none", prospectSubtype: null };
}

/* ───────── 신호 SQL(단건·일괄 공용) ─────────
   한 회원의 실데이터 신호 + 자동 판정 단계 + 현재 저장 단계. 일괄 재평가는 같은 식을 CTE로 전원에 적용한다. */
export const SIGNALS_SELECT_SQL = `
  SELECT m.id, m.donor_type, m.prospect_subtype, m.hyosung_contract_status,
    (SELECT COUNT(*)::int FROM billing_keys bk WHERE bk.member_id = m.id AND bk.is_active = true) AS toss_active,
    (SELECT COUNT(*)::int FROM billing_keys bk WHERE bk.member_id = m.id AND bk.deactivated_at IS NOT NULL) AS toss_deact,
    (SELECT COUNT(*)::int FROM donations d WHERE d.member_id = m.id AND d.type = 'onetime' AND d.status = 'completed') AS onetime_cnt,
    (SELECT COUNT(*)::int FROM donations d WHERE d.member_id = m.id AND d.status = 'completed') AS paid_cnt,
    (SELECT COALESCE(SUM(hb.received_amount), 0)::bigint FROM hyosung_billings hb
      WHERE m.hyosung_member_no IS NOT NULL AND hb.member_no = m.hyosung_member_no AND hb.received_amount > 0) AS hy_received,
    GREATEST(
      (SELECT MAX(COALESCE(d.paid_at, d.created_at)) FROM donations d WHERE d.member_id = m.id AND d.status = 'completed'),
      (SELECT MAX(hb.payment_date) FROM hyosung_billings hb
        WHERE m.hyosung_member_no IS NOT NULL AND hb.member_no = m.hyosung_member_no AND hb.received_amount > 0)
    ) AS last_paid,
    EXISTS (SELECT 1 FROM potential_donors pd WHERE pd.linked_member_id = m.id) AS has_pd
  FROM members m`;

export const AUTO_STAGE_CASE_SQL = `
    CASE
      WHEN s.toss_active > 0 OR LOWER(COALESCE(s.hyosung_contract_status, '')) = 'active' THEN 'regular'
      WHEN s.toss_deact > 0 OR LOWER(COALESCE(s.hyosung_contract_status, '')) IN ('cancelled', 'suspended', 'expired', 'terminated') THEN
        CASE WHEN (s.paid_cnt > 0 OR s.hy_received > 0)
                  AND (s.last_paid IS NULL OR s.last_paid >= NOW() - INTERVAL '${LAPSE_MONTHS} months')
             THEN 'prospect_cancelled' ELSE 'potential' END
      WHEN s.onetime_cnt > 0 THEN 'prospect_onetime'
      WHEN s.has_pd THEN 'potential'
      ELSE 'member'
    END`;

export const CHANNELS_CASE_SQL = `
    CASE WHEN s.toss_active > 0 AND LOWER(COALESCE(s.hyosung_contract_status, '')) = 'active' THEN '["toss","hyosung"]'::jsonb
         WHEN s.toss_active > 0 THEN '["toss"]'::jsonb
         WHEN LOWER(COALESCE(s.hyosung_contract_status, '')) = 'active' THEN '["hyosung"]'::jsonb
         ELSE '[]'::jsonb END`;

export const CURRENT_STAGE_CASE_SQL = `
    CASE WHEN s.donor_type = 'regular' THEN 'regular'
         WHEN s.donor_type = 'prospect' AND s.prospect_subtype = 'cancelled' THEN 'prospect_cancelled'
         WHEN s.donor_type = 'prospect' THEN 'prospect_onetime'
         WHEN s.has_pd THEN 'potential' ELSE 'member' END`;

export interface AutoStageResult {
  stage: DonorStage;
  currentStage: DonorStage;
  channels: string[];
  signals: { tossActive: number; tossDeact: number; onetimeCount: number; paidCount: number; hyosungReceived: number; lastPaid: string | null; hyosungStatus: string | null; hasPotentialRow: boolean };
}

/** 한 회원의 자동 판정 */
export async function computeAutoStage(memberId: number): Promise<AutoStageResult | null> {
  const rs = await db.execute(sql.raw(`
    WITH s AS (${SIGNALS_SELECT_SQL} WHERE m.id = ${Number(memberId)})
    SELECT s.*, ${AUTO_STAGE_CASE_SQL} AS auto_stage, ${CHANNELS_CASE_SQL} AS channels, ${CURRENT_STAGE_CASE_SQL} AS cur_stage FROM s`));
  const r = rowsOf(rs)[0];
  if (!r) return null;
  const channels = Array.isArray(r.channels) ? r.channels : (typeof r.channels === "string" ? JSON.parse(r.channels) : []);
  return {
    stage: isDonorStage(r.auto_stage) ? r.auto_stage : "member",
    currentStage: isDonorStage(r.cur_stage) ? r.cur_stage : "member",
    channels,
    signals: {
      tossActive: Number(r.toss_active) || 0, tossDeact: Number(r.toss_deact) || 0, onetimeCount: Number(r.onetime_cnt) || 0,
      paidCount: Number(r.paid_cnt) || 0, hyosungReceived: Number(r.hy_received) || 0,
      lastPaid: r.last_paid ? new Date(r.last_paid).toISOString() : null, hyosungStatus: r.hyosung_contract_status || null, hasPotentialRow: !!r.has_pd,
    },
  };
}

export interface StageOverride { id: number; toStage: DonorStage; autoBaseline: DonorStage | null; reason: string | null; changedByName: string | null; createdAt: string | null }

/** 유효한 수동 지정(최신 1건) — 표 없으면 null */
export async function getActiveOverride(memberId: number): Promise<StageOverride | null> {
  try {
    const r = rowsOf(await db.execute(sql`
      SELECT id, to_stage, auto_baseline, reason, changed_by_name, created_at FROM donor_stage_events
       WHERE member_id = ${memberId} AND source = 'manual' AND is_override = TRUE AND released_at IS NULL
       ORDER BY id DESC LIMIT 1`))[0];
    if (!r) return null;
    return { id: Number(r.id), toStage: r.to_stage, autoBaseline: r.auto_baseline || null, reason: r.reason || null, changedByName: r.changed_by_name || null, createdAt: r.created_at ? new Date(r.created_at).toISOString() : null };
  } catch (e) { if (missingTable(e)) return null; throw e; }
}

export async function releaseOverride(eventId: number, reason: string): Promise<void> {
  try {
    await db.execute(sql`UPDATE donor_stage_events SET is_override = FALSE, released_at = NOW(), release_reason = ${reason.slice(0, 100)} WHERE id = ${eventId}`);
  } catch (e) { if (!missingTable(e)) throw e; }
}

export interface StageEventInput {
  memberId: number; potentialDonorId?: number | null; fromStage: DonorStage | null; toStage: DonorStage;
  source: "manual" | "auto" | "system"; reason?: string | null; autoBaseline?: DonorStage | null; isOverride?: boolean;
  changedBy?: number | null; changedByName?: string | null;
}

/** 단계 변화 기록 — 표 없으면 조용히 null */
export async function recordStageEvent(ev: StageEventInput): Promise<number | null> {
  try {
    const r = rowsOf(await db.execute(sql`
      INSERT INTO donor_stage_events (member_id, potential_donor_id, from_stage, to_stage, source, reason, auto_baseline, is_override, changed_by, changed_by_name, created_at)
      VALUES (${ev.memberId}, ${ev.potentialDonorId ?? null}, ${ev.fromStage ?? null}, ${ev.toStage}, ${ev.source}, ${ev.reason ? String(ev.reason).slice(0, 1000) : null},
              ${ev.autoBaseline ?? null}, ${ev.isOverride === true}, ${ev.changedBy ?? null}, ${ev.changedByName ? String(ev.changedByName).slice(0, 50) : null}, NOW())
      RETURNING id`))[0];
    return r ? Number(r.id) : null;
  } catch (e) { if (missingTable(e)) return null; throw e; }
}

/** 단계를 members 컬럼에 적용(자동 재평가·수동 이동 공용) */
export async function applyStageToMember(memberId: number, stage: DonorStage, channels: string[] = []): Promise<void> {
  const c = stageToColumns(stage);
  await db.execute(sql`
    UPDATE members
       SET donor_type = ${c.donorType}, prospect_subtype = ${c.prospectSubtype},
           donor_channels = ${JSON.stringify(channels)}::jsonb, donor_evaluated_at = NOW(), updated_at = NOW()
     WHERE id = ${memberId}`);
}

/** 회원이 잠재 단계가 될 때 잠재 화면에 보이도록 연결된 잠재 행을 보장(없을 때만 생성). 생성/기존 행 id 반환 */
export async function ensurePotentialRowForMember(memberId: number, opts: { eventName: string; entryPath: string; memo?: string | null }): Promise<number | null> {
  const existing = rowsOf(await db.execute(sql`SELECT id FROM potential_donors WHERE linked_member_id = ${memberId} ORDER BY id ASC LIMIT 1`))[0];
  if (existing) return Number(existing.id);
  const m = rowsOf(await db.execute(sql`SELECT name, phone, email FROM members WHERE id = ${memberId} LIMIT 1`))[0];
  if (!m) return null;
  const email = String(m.email || "");
  const r = rowsOf(await db.execute(sql`
    INSERT INTO potential_donors (name, phone, email, event_name, entry_path, participated_at, memo, linked_member_id, linked_at, linked_by, created_at, updated_at)
    VALUES (${String(m.name || "후원자").slice(0, 50)}, ${m.phone || null}, ${/@noemail\./i.test(email) || /@lantern\.invalid$/i.test(email) ? null : (email || null)},
            ${opts.eventName.slice(0, 100)}, ${opts.entryPath.slice(0, 100)}, NOW(), ${opts.memo || null}, ${memberId}, NOW(), NULL, NOW(), NOW())
    RETURNING id`))[0];
  return r ? Number(r.id) : null;
}

export async function stageEventsTableExists(): Promise<boolean> {
  const r = rowsOf(await db.execute(sql`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'donor_stage_events'`));
  return r.length > 0;
}
