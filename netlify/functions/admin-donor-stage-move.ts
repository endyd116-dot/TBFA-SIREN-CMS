/**
 * POST /api/admin/donor-stage-move  — 후원자 단계 수동 이동 (2026-10-18)
 *   body: { memberId? | potentialId?, toStage: 'potential'|'prospect_onetime'|'prospect_cancelled'|'regular', reason? }
 *   응답: { ok, data: { memberId, potentialId, fromStage, toStage, autoStage, override, eventId } }
 *
 * 동작
 *   · 잠재 행만 있고 회원이 없으면 가벼운 회원(로그인 불가·리드)을 만들어 연결한 뒤 단계를 적용(예비·정기는 회원 기반이라 필요)
 *   · '잠재'로 옮기면 잠재 화면에 보이도록 연결된 잠재 행을 보장(없으면 생성)
 *   · 자동 판정(실데이터)과 다른 단계로 옮기면 «수동 지정»으로 기록돼 실데이터가 바뀔 때까지 유지(lib/donor-stage.ts)
 *   · 모든 이동은 donor_stage_events(이력) + audit_logs에 남는다
 * 선행: migrate-customer-journey (donor_stage_events 표). 표가 없으면 409.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import {
  type DonorStage, MANUAL_STAGES, STAGE_LABEL, computeAutoStage, getActiveOverride, releaseOverride,
  recordStageEvent, applyStageToMember, ensurePotentialRowForMember, stageEventsTableExists,
} from "../../lib/donor-stage";

export const config = { path: "/api/admin/donor-stage-move" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];
const res = (status: number, body: object) => new Response(jsonKST(body), { status, headers: JSON_HEADER });

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
  if (req.method !== "POST") return res(405, { ok: false, error: "Method Not Allowed" });

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const admin = (auth as any).ctx?.admin;
  const adminUid = Number(admin?.uid) || null;
  const adminName = String(admin?.name || (auth as any).ctx?.member?.name || "관리자").slice(0, 50);

  let body: any = {};
  try { body = await req.json(); } catch { return res(400, { ok: false, error: "JSON 파싱 실패" }); }
  const toStage = String(body.toStage || "") as DonorStage;
  if (!MANUAL_STAGES.includes(toStage)) return res(400, { ok: false, error: "toStage는 potential · prospect_onetime · prospect_cancelled · regular 중 하나" });
  const reason = String(body.reason || "").trim().slice(0, 300);
  let memberId = Number(body.memberId) || 0;
  let potentialId = Number(body.potentialId) || 0;

  let step = "precheck";
  try {
    if (!(await stageEventsTableExists())) return res(409, { ok: false, error: "단계 이력 저장소(donor_stage_events)가 아직 없습니다 — migrate-customer-journey?run=1 실행 필요" });

    /* ── 1. 대상 회원 확정(잠재만 있으면 리드 회원 생성·연결) ── */
    step = "resolve";
    let potentialRow: any = null;
    if (potentialId) {
      potentialRow = rowsOf(await db.execute(sql`SELECT id, name, phone, email, linked_member_id FROM potential_donors WHERE id = ${potentialId} LIMIT 1`))[0] || null;
      if (!potentialRow) return res(404, { ok: false, error: "잠재 후원자를 찾을 수 없습니다" });
      if (!memberId && potentialRow.linked_member_id) memberId = Number(potentialRow.linked_member_id);
    }
    let createdMember = false;
    if (!memberId) {
      if (!potentialRow) return res(400, { ok: false, error: "memberId 또는 potentialId가 필요합니다" });
      step = "create_lead_member";
      const name = String(potentialRow.name || "후원자").slice(0, 100);
      const phone = potentialRow.phone ? String(potentialRow.phone) : null;
      const realEmail = String(potentialRow.email || "").trim();
      const email = realEmail || `lead-${potentialRow.id}@noemail.tbfa.local`;
      /* 같은 전화·이메일 회원이 이미 있으면 그 회원 사용 */
      const digits = String(phone || "").replace(/[^0-9]/g, "");
      const found = rowsOf(await db.execute(sql`
        SELECT id FROM members
         WHERE (${realEmail}::text <> '' AND LOWER(email) = LOWER(${realEmail}))
            OR (${digits}::text <> '' AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = ${digits})
         ORDER BY CASE donor_type WHEN 'regular' THEN 0 WHEN 'prospect' THEN 1 ELSE 2 END, id ASC LIMIT 1`))[0];
      if (found) memberId = Number(found.id);
      else {
        const ins = rowsOf(await db.execute(sql`
          INSERT INTO members (name, email, phone, password_hash, type, status, donor_type, prospect_entry_path,
                               agree_email, agree_sms, phone_verified_at, kakao_marketing_consent_at, donor_evaluated_at, memo, created_at, updated_at)
          VALUES (${name}, ${email}, ${phone}, ${"!nurture-lead-no-login"}, 'regular', 'active', 'none', 'potential_lead',
                  ${!!realEmail}, true, ${digits ? sql`NOW()` : sql`NULL`}, ${digits ? sql`NOW()` : sql`NULL`}, NOW(),
                  ${`[단계 이동] 잠재 #${potentialRow.id}에서 운영자가 ${STAGE_LABEL[toStage]}(으)로 이동하며 생성`}, NOW(), NOW())
          RETURNING id`))[0];
        memberId = Number(ins?.id) || 0;
        createdMember = true;
      }
      if (!memberId) return res(500, { ok: false, error: "회원 생성 실패" });
      await db.execute(sql`UPDATE potential_donors SET linked_member_id = ${memberId}, linked_at = NOW(), linked_by = ${adminUid}, updated_at = NOW() WHERE id = ${potentialRow.id} AND linked_member_id IS NULL`);
    }

    /* ── 2. 현재·자동 판정 ── */
    step = "evaluate";
    const auto = await computeAutoStage(memberId);
    if (!auto) return res(404, { ok: false, error: "회원을 찾을 수 없습니다" });
    const fromStage = auto.currentStage;

    /* ── 3. 잠재로 옮기면 잠재 행 보장 ── */
    step = "ensure_potential";
    if (toStage === "potential") {
      const pid = await ensurePotentialRowForMember(memberId, { eventName: "수동 이동(잠재)", entryPath: "manual_move", memo: `[단계 이동] ${adminName}: ${reason || "사유 없음"}` });
      if (pid && !potentialId) potentialId = pid;
    }

    /* ── 4. 기존 수동 지정 정리 + 새 이력 ── */
    step = "record";
    const prev = await getActiveOverride(memberId);
    if (prev) await releaseOverride(prev.id, `manual:${toStage}`);
    const isOverride = toStage !== auto.stage;
    const eventId = await recordStageEvent({
      memberId, potentialDonorId: potentialId || null, fromStage, toStage, source: "manual",
      reason: reason || null, autoBaseline: auto.stage, isOverride, changedBy: adminUid, changedByName: adminName,
    });

    /* ── 5. 적용 ── */
    step = "apply";
    await applyStageToMember(memberId, toStage, toStage === "regular" ? auto.channels : []);

    await logAdminAction(req as any, admin?.uid, admin?.name, "donor_stage_move", {
      target: `M-${memberId}`, detail: { fromStage, toStage, autoStage: auto.stage, override: isOverride, reason, potentialId: potentialId || null, createdMember },
    }).catch(() => {});

    return res(200, {
      ok: true,
      message: `${STAGE_LABEL[fromStage]} → ${STAGE_LABEL[toStage]}${isOverride ? " (수동 지정 — 실데이터가 바뀌면 자동 해제)" : ""}`,
      data: { memberId, potentialId: potentialId || null, fromStage, toStage, autoStage: auto.stage, override: isOverride, eventId, createdMember },
    });
  } catch (err: any) {
    return res(500, {
      ok: false, error: "단계 이동 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    });
  }
};
