/**
 * nurture-test-send — 1회용 테스트: 너처링 "시스템(엔진)"이 정기후원자 시퀀스를 테스트 회원에게 발송.
 *
 * ★ 직접 문자 쏘지 않음. 실제 엔진 runNurture()를 테스트 스코프(이 회원·이 여정·빈도제한 우회·
 *   영구 스킵)로 호출 → 엔진이 템플릿·채널·디스패처·인앱·nurture_sends 기록까지 평소대로 처리.
 *
 * GET ?email=...                                 → 진단(인증 불필요): 회원·정기 단계 목록.
 * GET ?action=setup&secret=..&phone=..&name=..   → 테스트 회원 등록 + 정기 D+3·D+7 보강 + 기록 초기화.
 * GET ?action=fire&secret=..&step=N              → N번째 정기 단계를 엔진으로 발송(enrolled_at 조정 후 runNurture).
 *
 * 1분 간격은 호출자(셸)가 step=0,1,2를 60초 간격 호출해 제어. 테스트 후 이 파일 삭제(1회용).
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { runNurture } from "../../lib/nurture-engine";
import { executeTrigger } from "../../lib/communication-auto-trigger";
import { triggerDispatchBackground } from "../../lib/communication-dispatcher-core";

export const config = { path: "/api/nurture-test-send" };
const H = { "Content-Type": "application/json; charset=utf-8" };
const DEFAULT_EMAIL = "endyd116@gmail.com";

function out(obj: object, status = 200) { return new Response(JSON.stringify(obj, null, 2), { status, headers: H }); }
function rows(r: any): any[] { return (r?.rows ?? r ?? []) as any[]; }
function mask(p: string): string { const d = String(p || "").replace(/[^0-9]/g, ""); return d.length < 7 ? d : d.slice(0, 3) + "****" + d.slice(-4); }

/* 정기 환영 시리즈 보강용 신규 단계(D+3·D+7) — 멱등 시드 */
const EXTRA_STEPS = [
  { dayOffset: 3, tplName: "[너처링·문자] 정기 D3",
    body: "{{이름}}님, 보내주신 후원은 순직 교사 유가족의 심리상담·법률지원·장학에 쓰입니다. 한 분의 마음이 유가족께 큰 힘이 됩니다. 그 변화를 꾸준히 전해드릴게요. -교사유가족협의회" },
  { dayOffset: 7, tplName: "[너처링·문자] 정기 D7",
    body: "{{이름}}님, 교사유가족협의회와 함께해 주셔서 감사합니다. 우리는 선생님들을 기억하고 유가족이 다시 일어설 수 있도록 곁을 지킵니다. {{이름}}님도 그 길에 함께 계십니다. -교사유가족협의회" },
];

async function regularJourneyId(): Promise<number> {
  const j = rows(await db.execute(sql`SELECT id FROM nurture_journeys WHERE segment='regular' ORDER BY id LIMIT 1`))[0];
  return Number(j?.id) || 0;
}
async function regularSteps(jid: number): Promise<any[]> {
  return rows(await db.execute(sql`
    SELECT s.id, s.day_offset AS "dayOffset", s.channel, s.template_id AS "tplId", s.label,
           t.name AS "tplName", t.body_template AS "body"
      FROM nurture_steps s LEFT JOIN communication_templates t ON t.id = s.template_id
     WHERE s.journey_id = ${jid} AND s.is_active = true AND s.template_id IS NOT NULL
     ORDER BY s.day_offset ASC`));
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || DEFAULT_EMAIL).trim();
  const secret = url.searchParams.get("secret") || "";
  const action = url.searchParams.get("action") || "";
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  const authed = !!expected && secret === expected;

  async function findMember() {
    return rows(await db.execute(sql`
      SELECT id, name, phone, donor_type AS "donorType", agree_sms AS "agreeSms", agree_email AS "agreeEmail",
             phone_verified_at AS "phoneVerifiedAt", kakao_marketing_consent_at AS "kakaoConsent"
        FROM members WHERE LOWER(email) = LOWER(${email}) ORDER BY id ASC LIMIT 1`))[0];
  }

  /* ── 셋업: 테스트 회원 등록 + 정기 D+3·D+7 보강 + 기록 초기화 ── */
  if (action === "setup") {
    if (!authed) return out({ ok: false, error: "시크릿 불일치" }, 403);
    const phone = String(url.searchParams.get("phone") || "").replace(/[^0-9]/g, "");
    const nm = (url.searchParams.get("name") || "테스트후원자").trim().slice(0, 40);
    if (phone.length < 10) return out({ ok: false, error: "phone 필요(숫자 10자리+)" }, 400);

    /* 1) 회원 upsert (정기후원자·동의·인증 ON). password_hash NOT NULL → 로그인 불가 placeholder */
    const ex = rows(await db.execute(sql`SELECT id FROM members WHERE LOWER(email) = LOWER(${email}) LIMIT 1`))[0];
    let memberId: number;
    if (ex) {
      await db.execute(sql`UPDATE members SET name=${nm}, phone=${phone}, donor_type='regular', status='active',
        agree_sms=true, agree_email=true, phone_verified_at=COALESCE(phone_verified_at, NOW()),
        kakao_marketing_consent_at=COALESCE(kakao_marketing_consent_at, NOW()), updated_at=NOW() WHERE id=${ex.id}`);
      memberId = ex.id;
    } else {
      const ins = rows(await db.execute(sql`INSERT INTO members (name, email, phone, password_hash, type, status, donor_type, prospect_entry_path,
        agree_email, agree_sms, phone_verified_at, kakao_marketing_consent_at, donor_evaluated_at, created_at, updated_at)
        VALUES (${nm}, ${email}, ${phone}, ${"!nurture-test-no-login"}, 'regular', 'active', 'regular', 'nurture_test',
          true, true, NOW(), NOW(), NOW(), NOW(), NOW()) RETURNING id`))[0];
      memberId = Number(ins?.id);
    }

    /* 2) 정기 여정 D+3·D+7 단계 보강 (멱등) */
    const jid = await regularJourneyId();
    const seeded: any[] = [];
    if (jid) {
      const baseVars = rows(await db.execute(sql`SELECT variables FROM communication_templates WHERE category='nurture' AND channel='sms' AND variables IS NOT NULL LIMIT 1`))[0]?.variables;
      const varsJson = JSON.stringify(Array.isArray(baseVars) ? baseVars : []);
      for (const st of EXTRA_STEPS) {
        const haveStep = rows(await db.execute(sql`SELECT id FROM nurture_steps WHERE journey_id=${jid} AND day_offset=${st.dayOffset} LIMIT 1`))[0];
        if (haveStep) { seeded.push({ dayOffset: st.dayOffset, status: "이미있음" }); continue; }
        let tplId = rows(await db.execute(sql`SELECT id FROM communication_templates WHERE name=${st.tplName} LIMIT 1`))[0]?.id;
        if (!tplId) {
          tplId = rows(await db.execute(sql`INSERT INTO communication_templates (name, channel, category, subject, body_template, variables, is_active, created_at, updated_at)
            VALUES (${st.tplName}, 'sms', 'nurture', NULL, ${st.body}, ${varsJson}::jsonb, true, NOW(), NOW()) RETURNING id`))[0]?.id;
        }
        await db.execute(sql`INSERT INTO nurture_steps (journey_id, day_offset, channel, template_id, label, is_active, conditions, sort_order)
          VALUES (${jid}, ${st.dayOffset}, 'sms', ${tplId}, ${"정기 환영 D+" + st.dayOffset}, true, '{}'::jsonb, ${st.dayOffset})`);
        seeded.push({ dayOffset: st.dayOffset, tplId, status: "신규" });
      }
      /* 3) 이 회원 기록 초기화(재테스트 깨끗하게): 기존 발송기록·참여 삭제 후 재참여 */
      await db.execute(sql`DELETE FROM nurture_sends WHERE enrollment_id IN (SELECT id FROM nurture_enrollments WHERE member_id=${memberId})`);
      await db.execute(sql`DELETE FROM nurture_enrollments WHERE member_id=${memberId}`);
      await db.execute(sql`INSERT INTO nurture_enrollments (member_id, journey_id, enrolled_at, status) VALUES (${memberId}, ${jid}, NOW(), 'active') ON CONFLICT (member_id, journey_id) DO NOTHING`);
    }
    const steps = await regularSteps(jid);
    return out({ ok: true, action: "setup", memberId, email, phoneMasked: mask(phone), name: nm, journeyId: jid,
      seeded, stepCount: steps.length, steps: steps.map((s, i) => ({ idx: i, when: `D+${s.dayOffset}`, tplName: s.tplName })) });
  }

  /* ── 발송: N번째 정기 단계를 엔진으로 (시크릿) ── */
  if (action === "fire") {
    if (!authed) return out({ ok: false, error: "시크릿 불일치" }, 403);
    const member = await findMember();
    if (!member) return out({ ok: false, error: `회원 없음: ${email} (먼저 action=setup)` }, 404);
    const jid = await regularJourneyId();
    const steps = await regularSteps(jid);
    const step = Number(url.searchParams.get("step") || "0");
    const target = steps[step];
    if (!target) return out({ ok: false, error: `단계 없음 step=${step} (총 ${steps.length})` }, 400);

    /* 이 단계만 due가 되도록 enrolled_at = NOW() - dayOffset일 (grace 내 1단계만 발화) */
    await db.execute(sql`INSERT INTO nurture_enrollments (member_id, journey_id, enrolled_at, status)
      VALUES (${member.id}, ${jid}, NOW(), 'active')
      ON CONFLICT (member_id, journey_id) DO UPDATE SET status='active', converted_at=NULL`);
    await db.execute(sql.raw(`UPDATE nurture_enrollments SET enrolled_at = NOW() - INTERVAL '${Number(target.dayOffset)} days', updated_at = NOW()
      WHERE member_id = ${Number(member.id)} AND journey_id = ${Number(jid)}`));

    /* ★ 실제 엔진 구동(이 회원·이 여정·빈도제한 우회·영구 스킵) */
    const summary = await runNurture({ onlyMemberId: Number(member.id), journeyOverrideId: jid, bypassFrequencyCap: true, skipEvergreen: true });

    return out({ ok: true, action: "fire", step, fired: { when: `D+${target.dayOffset}`, channel: target.channel, tplName: target.tplName,
      preview: String(target.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) },
      engineSummary: summary, note: summary.stepsFired > 0 ? "엔진이 발송 큐에 적재(디스패처가 곧 전송)" : "발송 0 — 도달성/조건 확인" });
  }

  /* ── 발송결과 조회: 이 회원 최근 수신자 상태·에러 (시크릿) ── */
  if (action === "status") {
    if (!authed) return out({ ok: false, error: "시크릿 불일치" }, 403);
    const m = await findMember();
    if (!m) return out({ ok: false, error: "회원 없음" }, 404);
    const recips = rows(await db.execute(sql`
      SELECT r.id, r.job_id AS "jobId", r.channel, r.status, r.error, r.sent_at AS "sentAt", r.retry_count AS "retry",
             LEFT(r.rendered_body, 50) AS "bodyHead", j.status AS "jobStatus", j.name AS "jobName"
        FROM communication_send_recipients r JOIN communication_send_jobs j ON j.id = r.job_id
       WHERE r.member_id = ${m.id} ORDER BY r.id DESC LIMIT 12`));
    const ns = rows(await db.execute(sql`
      SELECT s.id, s.step_id AS "stepId", s.channel, s.status, s.sent_at AS "sentAt"
        FROM nurture_sends s JOIN nurture_enrollments e ON e.id = s.enrollment_id
       WHERE e.member_id = ${m.id} ORDER BY s.id DESC LIMIT 12`));
    return out({ ok: true, action: "status", memberId: m.id, sender: process.env.SOLAPI_SENDER || "(미설정)",
      recipients: recips, nurtureSends: ns });
  }

  /* ── migrate: recipient_group_id NOT NULL 제약 해제 (자동/시스템 발송용·시크릿·멱등) ── */
  if (action === "migrate") {
    if (!authed) return out({ ok: false, error: "시크릿 불일치" }, 403);
    const before = rows(await db.execute(sql`SELECT is_nullable FROM information_schema.columns WHERE table_name='communication_send_jobs' AND column_name='recipient_group_id'`))[0];
    await db.execute(sql`ALTER TABLE communication_send_jobs ALTER COLUMN recipient_group_id DROP NOT NULL`);
    const after = rows(await db.execute(sql`SELECT is_nullable FROM information_schema.columns WHERE table_name='communication_send_jobs' AND column_name='recipient_group_id'`))[0];
    return out({ ok: true, action: "migrate", column: "recipient_group_id", before: before?.is_nullable, after: after?.is_nullable });
  }

  /* ── probe: 문자 발송(executeTrigger) 직접 호출해 에러 노출 (시크릿) ── */
  if (action === "probe") {
    if (!authed) return out({ ok: false, error: "시크릿 불일치" }, 403);
    const m = await findMember();
    if (!m) return out({ ok: false, error: "회원 없음" }, 404);
    const jid = await regularJourneyId();
    const steps = await regularSteps(jid);
    const step = Number(url.searchParams.get("step") || "0");
    const target = steps[step];
    if (!target) return out({ ok: false, error: `단계 없음 step=${step}` }, 400);
    /* 템플릿 활성 여부 확인 */
    const tpl = rows(await db.execute(sql`SELECT id, name, channel, is_active AS "isActive" FROM communication_templates WHERE id = ${Number(target.tplId)} LIMIT 1`))[0];
    /* 실제 발송 큐 생성 시도 */
    const r = await executeTrigger({ id: 9999, name: `probe ${target.label}`, templateId: Number(target.tplId), channel: "sms" }, [Number(m.id)], { unsubscribe: true });
    /* 디스패처 구동 */
    let dispatch: any = null;
    if (r.jobId) { try { dispatch = await triggerDispatchBackground(); } catch (e: any) { dispatch = { error: String(e?.message || e).slice(0, 200) }; } }
    return out({ ok: true, action: "probe", step, templateId: target.tplId, template: tpl || "(템플릿 행 없음)",
      executeTrigger: { jobId: r.jobId, error: r.error || null }, dispatch });
  }

  /* ── 진단 ── */
  const member = await findMember();
  const jid = await regularJourneyId();
  const steps = await regularSteps(jid);
  return out({
    ok: true, mode: "diagnostic", email,
    member: member ? {
      id: member.id, name: member.name, phoneMasked: mask(member.phone), donorType: member.donorType,
      agreeSms: member.agreeSms, agreeEmail: member.agreeEmail,
      phoneVerified: !!member.phoneVerifiedAt, kakaoConsent: !!member.kakaoConsent,
    } : null,
    journeyId: jid, stepCount: steps.length,
    steps: steps.map((s, i) => ({ idx: i, when: `D+${s.dayOffset}`, channel: s.channel, tplName: s.tplName,
      preview: String(s.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 70) })),
    hint: "셋업: ?action=setup&secret=..&phone=..&name=.. / 발송: ?action=fire&secret=..&step=0 (step 0,1,2 60초 간격)",
  });
};
