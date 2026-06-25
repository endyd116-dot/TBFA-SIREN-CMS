// lib/nurture-engine.ts
// ★ 2026-06-26 후원자 너처링 엔진 (Phase 1)
//
// 매일 1회(cron-nurture-runner) 실행:
//   1) enroll  — 활성 여정의 세그먼트 구성원 중 미등록 회원을 enrollment 생성(D0=분류일)
//   2) sync    — 회원 세그먼트가 바뀌면 enrollment 종료(정기 전환=converted / 그 외=exited)
//   3) steps   — 오늘 due인 단계를 동의·중복·빈도 체크 후 발송 큐로(executeTrigger 재사용)
//   4) evergreen — D365+/타임라인 종료 후 영구 규칙(분기·기념일 등)
//
// 안전: 수신 동의 게이트(채널별)·단계 멱등(nurture_sends UNIQUE)·빈도 상한(하루 1·주 3).
//   발송 자체는 기존 communication_send 엔진 재사용(executeTrigger → 디스패처).
//   여정 is_active=false면 아무것도 안 함(기본 OFF).

import { sql } from "drizzle-orm";
import { db } from "../db";
import { executeTrigger } from "./communication-auto-trigger";
import { triggerDispatchBackground } from "./communication-dispatcher-core";

const GRACE_DAYS = 2;   // 단계 due 윈도우(빈도 상한에 밀린 단계 만회 여유)
const DAILY_CAP = 1;    // 하루 1통
const WEEKLY_CAP = 3;   // 주 3통

/* 세그먼트 → members WHERE.
   potential(잠재)은 potential_donors를 가벼운 lead 회원으로 동기화(syncPotentialLeads) 후
   prospect_entry_path='potential_lead' 마커로 식별(2026-06-26 B안). */
const SEGMENT_MEMBER_WHERE: Record<string, string> = {
  regular:            "m.donor_type = 'regular'",
  prospect_onetime:   "m.donor_type = 'prospect' AND m.prospect_subtype = 'onetime'",
  prospect_cancelled: "m.donor_type = 'prospect' AND m.prospect_subtype = 'cancelled'",
  potential:          "m.donor_type = 'none' AND m.prospect_entry_path = 'potential_lead'",
};

/* 잠재 리드 동기화 — potential_donors(이메일 있음·미연결)를 가벼운 lead 회원으로.
   기존 회원과 이메일/전화 매칭되면 연결만, 없으면 생성(donor_type='none'·마커·마케팅 동의 ON).
   잠재는 수집 시 마케팅 동의 완료 전제(Swain). 멱등: linked_member_id로 재실행 안전. */
const LEAD_PLACEHOLDER_DOMAIN = "noemail.tbfa.local"; // 이메일 없는 리드용 placeholder(비전송)

async function syncPotentialLeads(): Promise<number> {
  let synced = 0;
  let rows: any[] = [];
  try {
    /* 연락 가능(이메일 또는 전화)한 미연결 잠재 */
    const r: any = await db.execute(sql`
      SELECT id, name, email, phone FROM potential_donors
       WHERE linked_member_id IS NULL
         AND ((email IS NOT NULL AND email <> '') OR (phone IS NOT NULL AND phone <> ''))
       ORDER BY id ASC LIMIT 500`);
    rows = (r?.rows ?? r ?? []) as any[];
  } catch (e) { console.error("[nurture] 잠재 조회 실패", e); return 0; }

  for (const pd of rows) {
    try {
      const realEmail = String(pd.email || "").trim();
      const phone = String(pd.phone || "").trim();
      const phoneDigits = phone.replace(/[^0-9]/g, "");
      const name = (String(pd.name || "").trim() || "후원자").slice(0, 100);
      if (!realEmail && !phoneDigits) continue; // 연락 불가

      /* 기존 회원 매칭(이메일·전화) */
      let memberId = 0;
      const mr: any = await db.execute(sql`
        SELECT id FROM members
         WHERE (${realEmail}::text <> '' AND LOWER(email) = LOWER(${realEmail}))
            OR (${phoneDigits}::text <> '' AND regexp_replace(COALESCE(phone,''),'[^0-9]','','g') = ${phoneDigits})
         ORDER BY id ASC LIMIT 1`);
      memberId = Number((mr?.rows ?? mr ?? [])[0]?.id) || 0;

      if (!memberId) {
        /* 신규 lead 회원 — 이메일 없으면 placeholder(비전송)+agree_email=false → 문자/카톡만.
           잠재는 수집 시 마케팅 동의 완료 전제(Swain) → 전화 있으면 sms/kakao 동의·인증 ON. */
        const emailVal = realEmail || `lead-${pd.id}@${LEAD_PLACEHOLDER_DOMAIN}`;
        const agreeEmail = realEmail ? true : false;
        const phoneVerified = phoneDigits ? sql`NOW()` : sql`NULL`;
        const kakaoConsent = phoneDigits ? sql`NOW()` : sql`NULL`;
        const ins: any = await db.execute(sql`
          INSERT INTO members (name, email, phone, type, status, donor_type, prospect_entry_path,
            agree_email, agree_sms, phone_verified_at, kakao_marketing_consent_at,
            donor_evaluated_at, created_at, updated_at)
          VALUES (${name}, ${emailVal}, ${phone || null}, 'regular', 'active', 'none', 'potential_lead',
            ${agreeEmail}, true, ${phoneVerified}, ${kakaoConsent},
            NOW(), NOW(), NOW())
          RETURNING id`);
        memberId = Number((ins?.rows ?? ins ?? [])[0]?.id) || 0;
      }
      if (memberId) {
        await db.execute(sql`UPDATE potential_donors SET linked_member_id = ${memberId}, linked_at = NOW(), updated_at = NOW() WHERE id = ${pd.id} AND linked_member_id IS NULL`);
        synced++;
      }
    } catch (e: any) {
      console.warn(`[nurture] 잠재 동기화 실패 pd=${pd.id}: ${e?.message || e}`);
    }
  }
  return synced;
}

/* ★ A검증 #1 fix: 엔진 1차 방어 — sql.raw 인터폴레이션 전 채널 화이트리스트 */
const VALID_CHANNELS = new Set(["email", "sms", "kakao", "inapp"]);
const PLACEHOLDER_SUFFIX = "@noemail.tbfa.local"; // 이메일 없는 리드 placeholder(비전송)

/* 1차 채널 도달성(동의+발송가능) SQL gate */
function primaryGateSql(channel: string): string {
  switch (channel) {
    case "sms":   return "m.agree_sms IS NOT FALSE AND m.phone_verified_at IS NOT NULL";
    case "kakao": return "m.kakao_marketing_consent_at IS NOT NULL AND m.phone_verified_at IS NOT NULL";
    case "email": return `m.agree_email IS NOT FALSE AND m.email NOT LIKE '%${PLACEHOLDER_SUFFIX}'`;
    default:      return "TRUE"; // inapp
  }
}
const EMAIL_GATE_SQL = `m.agree_email IS NOT FALSE AND m.email NOT LIKE '%${PLACEHOLDER_SUFFIX}'`;

function isPlaceholder(email: any): boolean { return String(email || "").toLowerCase().endsWith(PLACEHOLDER_SUFFIX); }
function reachablePrimary(d: any, ch: string): boolean {
  if (ch === "sms")   return d.agree_sms !== false && d.phone_verified_at != null;
  if (ch === "kakao") return d.kakao_marketing_consent_at != null && d.phone_verified_at != null;
  if (ch === "email") return d.agree_email !== false && !isPlaceholder(d.email);
  if (ch === "inapp") return true;
  return false;
}
function reachableEmail(d: any): boolean { return d.agree_email !== false && !!d.email && !isPlaceholder(d.email); }

/* 1차 채널(문자/카톡) + 보조 메일 다채널 발송. 하나라도 보냈으면 true. */
async function sendMulti(due: any[], journeyId: number, name: string, primaryCh: string, primaryTpl: number | null, emailTpl: number | null): Promise<boolean> {
  const prim: number[] = [], mail: number[] = [];
  for (const d of due) {
    const mid = Number(d.member_id); if (!mid) continue;
    if (primaryTpl && reachablePrimary(d, primaryCh)) prim.push(mid);
    if (emailTpl && primaryCh !== "email" && reachableEmail(d)) mail.push(mid);
  }
  let any = false;
  if (prim.length && primaryTpl) {
    try { const r = await executeTrigger({ id: journeyId, name, templateId: primaryTpl, channel: primaryCh }, prim, { unsubscribe: true }); if (r.jobId) any = true; }
    catch (e: any) { console.error("[nurture] 1차 발송 실패:", e?.message || e); }
  }
  if (mail.length && emailTpl) {
    try { const r = await executeTrigger({ id: journeyId, name, templateId: emailTpl, channel: "email" }, mail, { unsubscribe: true }); if (r.jobId) any = true; }
    catch (e: any) { console.error("[nurture] 보조 메일 발송 실패:", e?.message || e); }
  }
  return any;
}

function affected(r: any): number {
  if (r == null) return 0;
  const c = (r as any).count; if (typeof c === "number") return c;
  const rc = (r as any).rowCount; if (typeof rc === "number") return rc;
  return 0;
}

export interface NurtureSummary {
  journeys: number;
  enrolled: number;
  ended: number;        // converted + exited
  stepsFired: number;
  recipients: number;
  evergreenFired: number;
  evergreenRecipients: number;
  dryRun: boolean;
}

export async function runNurture(opts?: { dryRun?: boolean }): Promise<NurtureSummary> {
  const dryRun = !!opts?.dryRun;
  const s: NurtureSummary = {
    journeys: 0, enrolled: 0, ended: 0, stepsFired: 0, recipients: 0,
    evergreenFired: 0, evergreenRecipients: 0, dryRun,
  };

  /* 활성 여정 */
  const jr: any = await db.execute(sql`SELECT id, segment, name FROM nurture_journeys WHERE is_active = true`);
  const journeys = (jr?.rows ?? jr ?? []);
  s.journeys = journeys.length;
  if (!journeys.length) return s;

  /* 잠재 여정이 활성이면, 발송 전에 potential_donors → lead 회원 동기화 (이메일 있는 동의 리드) */
  if (!dryRun && journeys.some((j: any) => String(j.segment) === "potential")) {
    try { await syncPotentialLeads(); } catch (e) { console.error("[nurture] 잠재 동기화 단계 실패", e); }
  }

  /* 1·2) enroll + sync (세그먼트 회원 기반만) */
  for (const j of journeys) {
    const segWhere = SEGMENT_MEMBER_WHERE[String(j.segment)];
    if (!segWhere) continue; // potential 등 미지원 — Phase 2
    if (dryRun) continue;

    const ins: any = await db.execute(sql.raw(`
      INSERT INTO nurture_enrollments (member_id, journey_id, enrolled_at, status)
      SELECT m.id, ${Number(j.id)}, COALESCE(m.donor_evaluated_at, NOW()), 'active'
      FROM members m
      WHERE (${segWhere}) AND m.status = 'active' AND m.withdrawn_at IS NULL AND m.blacklisted_at IS NULL
      ON CONFLICT (member_id, journey_id) DO NOTHING
    `));
    s.enrolled += affected(ins);

    const upd: any = await db.execute(sql.raw(`
      UPDATE nurture_enrollments e
      SET status = CASE WHEN m.donor_type = 'regular' AND '${String(j.segment)}' <> 'regular' THEN 'converted' ELSE 'exited' END,
          converted_at = CASE WHEN m.donor_type = 'regular' AND '${String(j.segment)}' <> 'regular' THEN NOW() ELSE e.converted_at END,
          updated_at = NOW()
      FROM members m
      WHERE e.member_id = m.id AND e.journey_id = ${Number(j.id)} AND e.status = 'active'
        AND NOT (${segWhere})
    `));
    s.ended += affected(upd);
  }

  /* 3) due 단계 발송 — 1차 채널(문자/카톡) + 보조 메일(있으면) */
  const stepsRes: any = await db.execute(sql`
    SELECT s.id, s.journey_id, s.day_offset, s.channel, s.template_id, s.email_template_id, s.label
    FROM nurture_steps s
    JOIN nurture_journeys j ON j.id = s.journey_id AND j.is_active = true
    WHERE s.is_active = true AND s.template_id IS NOT NULL
    ORDER BY s.journey_id, s.day_offset
  `);
  const steps = (stepsRes?.rows ?? stepsRes ?? []);

  let queuedAny = false;
  for (const st of steps) {
    const ch = String(st.channel);
    if (!VALID_CHANNELS.has(ch)) continue; // 방어: 비정상 채널 skip
    const emailTpl = st.email_template_id ? Number(st.email_template_id) : null;
    /* 도달성: 1차 채널 OR (보조 메일 설정 시) 메일 */
    const elig = emailTpl ? `((${primaryGateSql(ch)}) OR (${EMAIL_GATE_SQL}))` : `(${primaryGateSql(ch)})`;
    const dueRes: any = await db.execute(sql.raw(`
      SELECT e.id AS enrollment_id, e.member_id,
             m.agree_sms, m.phone_verified_at, m.kakao_marketing_consent_at, m.agree_email, m.email
      FROM nurture_enrollments e
      JOIN members m ON m.id = e.member_id
      WHERE e.journey_id = ${Number(st.journey_id)} AND e.status = 'active' AND m.blacklisted_at IS NULL
        AND FLOOR(EXTRACT(EPOCH FROM (NOW() - e.enrolled_at)) / 86400) >= ${Number(st.day_offset)}
        AND FLOOR(EXTRACT(EPOCH FROM (NOW() - e.enrolled_at)) / 86400) <= ${Number(st.day_offset) + GRACE_DAYS}
        AND NOT EXISTS (SELECT 1 FROM nurture_sends ns WHERE ns.enrollment_id = e.id AND ns.step_id = ${Number(st.id)})
        AND ${elig}
        AND (SELECT COUNT(*) FROM nurture_sends nd JOIN nurture_enrollments ed ON ed.id = nd.enrollment_id
              WHERE ed.member_id = e.member_id AND nd.sent_at >= NOW() - INTERVAL '1 day') < ${DAILY_CAP}
        AND (SELECT COUNT(*) FROM nurture_sends nw JOIN nurture_enrollments ew ON ew.id = nw.enrollment_id
              WHERE ew.member_id = e.member_id AND nw.sent_at >= NOW() - INTERVAL '7 days') < ${WEEKLY_CAP}
      LIMIT 400
    `));
    const due = (dueRes?.rows ?? dueRes ?? []);
    if (!due.length) continue;

    s.stepsFired++;
    s.recipients += due.length;
    if (dryRun) continue;

    const sent = await sendMulti(due, Number(st.journey_id), String(st.label || `너처링 D+${st.day_offset}`), ch, st.template_id ? Number(st.template_id) : null, emailTpl);
    if (!sent) continue; // 둘 다 실패 — 다음 실행 재시도

    /* 단계당 enrollment 1행 기록(채널은 1차) — cap은 '하루 1단계'. 보조 메일은 같은 단계로 묶음. */
    const valuesSql = due.map((d: any) => `(${Number(d.enrollment_id)}, ${Number(st.id)}, '${ch}', 'queued')`).join(",");
    try {
      await db.execute(sql.raw(`
        INSERT INTO nurture_sends (enrollment_id, step_id, channel, status)
        VALUES ${valuesSql}
        ON CONFLICT (enrollment_id, step_id) DO NOTHING
      `));
    } catch (e: any) {
      console.error(`[nurture] step ${st.id} sends 기록 실패:`, e?.message || e);
    }
    queuedAny = true;
  }

  /* 4) Evergreen — 타임라인(>=30일) 경과 후 cadence 주기로 발송 */
  const CADENCE_DAYS: Record<string, number> = { monthly: 30, quarterly: 90, anniversary: 365, yearend: 365 };
  const evRes: any = await db.execute(sql`
    SELECT r.id, r.journey_id, r.cadence, r.channel, r.template_id, r.email_template_id, r.label
    FROM nurture_evergreen_rules r
    JOIN nurture_journeys j ON j.id = r.journey_id AND j.is_active = true
    WHERE r.is_active = true AND r.template_id IS NOT NULL
  `);
  const evRules = (evRes?.rows ?? evRes ?? []);
  for (const r of evRules) {
    const ch = String(r.channel);
    if (!VALID_CHANNELS.has(ch)) continue; // 방어: 비정상 채널 skip
    const interval = CADENCE_DAYS[String(r.cadence)] ?? 90;
    const emailTpl = r.email_template_id ? Number(r.email_template_id) : null;
    const elig = emailTpl ? `((${primaryGateSql(ch)}) OR (${EMAIL_GATE_SQL}))` : `(${primaryGateSql(ch)})`;
    const dueRes: any = await db.execute(sql.raw(`
      SELECT e.id AS enrollment_id, e.member_id,
             m.agree_sms, m.phone_verified_at, m.kakao_marketing_consent_at, m.agree_email, m.email
      FROM nurture_enrollments e
      JOIN members m ON m.id = e.member_id
      WHERE e.journey_id = ${Number(r.journey_id)} AND e.status = 'active' AND m.blacklisted_at IS NULL
        AND FLOOR(EXTRACT(EPOCH FROM (NOW() - e.enrolled_at)) / 86400) >= 30
        AND (e.last_evergreen_at IS NULL OR e.last_evergreen_at <= NOW() - INTERVAL '${interval} days')
        AND ${elig}
        AND (SELECT COUNT(*) FROM nurture_sends nd JOIN nurture_enrollments ed ON ed.id = nd.enrollment_id
              WHERE ed.member_id = e.member_id AND nd.sent_at >= NOW() - INTERVAL '1 day') < ${DAILY_CAP}
      LIMIT 400
    `));
    const due = (dueRes?.rows ?? dueRes ?? []);
    if (!due.length) continue;

    s.evergreenFired++;
    s.evergreenRecipients += due.length;
    if (dryRun) continue;

    const sent = await sendMulti(due, Number(r.journey_id), String(r.label || `너처링 영구 ${r.cadence}`), ch, r.template_id ? Number(r.template_id) : null, emailTpl);
    if (!sent) continue;

    const enrollIds = due.map((d: any) => Number(d.enrollment_id));
    try {
      const valuesSql = enrollIds.map((eid) => `(${eid}, ${Number(r.id)}, '${ch}', 'queued')`).join(",");
      await db.execute(sql.raw(`
        INSERT INTO nurture_sends (enrollment_id, evergreen_rule_id, channel, status)
        VALUES ${valuesSql}
      `));
      await db.execute(sql.raw(`
        UPDATE nurture_enrollments SET last_evergreen_at = NOW(), updated_at = NOW()
        WHERE id IN (${enrollIds.join(",")})
      `));
    } catch (e: any) {
      console.error(`[nurture] evergreen ${r.id} 기록 실패:`, e?.message || e);
    }
    queuedAny = true;
  }

  /* 발송 큐 즉시 처리 */
  if (!dryRun && queuedAny) {
    try { await triggerDispatchBackground(); } catch (_) {}
  }

  return s;
}
