/**
 * nurture-test-send — 1회용 테스트: 정기후원자 너처링 초기 시퀀스를 특정 회원에게만 실발송.
 *
 * GET ?email=...                         → 진단(인증 불필요): 회원 조회 + 정기 시퀀스 후보 목록.
 * GET ?secret=...&email=...&seq=N&send=1 → 시크릿 인증 후 후보[N]을 실제 발송(문자+인앱+메일).
 *
 * 주의: 너처링 여정 enroll/toggle 안 함. 후보 템플릿을 회원 1명에게만 렌더·발송(대량발송 아님).
 *   1분 간격은 호출자(셸)가 seq=0,1,2를 60초 간격으로 호출해 제어.
 * 테스트 후 이 파일 삭제(1회용 보안 원칙).
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { solapiSendSms } from "../../lib/solapi-client";
import { sendNurtureKakao } from "../../lib/kakao-nurture-notice";
import { renderTemplate } from "../../lib/template-render";
import { buildMemberRenderData } from "../../lib/communication-send";
import { createNotification } from "../../lib/notify";
import { sendEmail } from "../../lib/email";
import { unsubUrl } from "../../lib/unsubscribe-token";

export const config = { path: "/api/nurture-test-send" };
const H = { "Content-Type": "application/json; charset=utf-8" };
const BASE_URL = process.env.SITE_URL || "https://tbfa.co.kr";
const DEFAULT_EMAIL = "endyd116@gmail.com";

function out(obj: object, status = 200) { return new Response(JSON.stringify(obj, null, 2), { status, headers: H }); }
function rows(r: any): any[] { return (r?.rows ?? r ?? []) as any[]; }
function mask(p: string): string { const d = String(p || "").replace(/[^0-9]/g, ""); return d.length < 7 ? d : d.slice(0, 3) + "****" + d.slice(-4); }

/* 정기 여정 후보(steps day_offset순 + evergreen) 로드 */
async function loadRegularCandidates() {
  const j = rows(await db.execute(sql`SELECT id, name FROM nurture_journeys WHERE segment = 'regular' ORDER BY id LIMIT 1`))[0];
  if (!j) return { journey: null, candidates: [] as any[] };
  const steps = rows(await db.execute(sql`
    SELECT s.day_offset AS "dayOffset", s.channel, s.template_id AS "tplId", s.email_template_id AS "emailTplId", s.label,
           t.name AS "tplName", t.body_template AS "body", t.subject, t.variables
      FROM nurture_steps s LEFT JOIN communication_templates t ON t.id = s.template_id
     WHERE s.journey_id = ${j.id} AND s.is_active = true AND s.template_id IS NOT NULL
     ORDER BY s.day_offset ASC`));
  const ever = rows(await db.execute(sql`
    SELECT r.cadence, r.channel, r.template_id AS "tplId", r.email_template_id AS "emailTplId", r.label,
           t.name AS "tplName", t.body_template AS "body", t.subject, t.variables
      FROM nurture_evergreen_rules r LEFT JOIN communication_templates t ON t.id = r.template_id
     WHERE r.journey_id = ${j.id} AND r.is_active = true AND r.template_id IS NOT NULL
     ORDER BY r.id ASC`));
  const candidates = [
    ...steps.map((s: any) => ({ kind: "step", when: `D+${s.dayOffset}`, ...s })),
    ...ever.map((e: any) => ({ kind: "evergreen", when: e.cadence, ...e })),
  ];
  return { journey: j, candidates };
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || DEFAULT_EMAIL).trim();
  const secret = url.searchParams.get("secret") || "";
  const send = url.searchParams.get("send") === "1";
  const seq = Number(url.searchParams.get("seq") || "0");

  /* 회원 조회 */
  const member = rows(await db.execute(sql`
    SELECT id, name, email, phone, donor_type AS "donorType", agree_sms AS "agreeSms", agree_email AS "agreeEmail",
           phone_verified_at AS "phoneVerifiedAt", kakao_marketing_consent_at AS "kakaoConsent"
      FROM members WHERE LOWER(email) = LOWER(${email}) ORDER BY id ASC LIMIT 1`))[0];

  const { journey, candidates } = await loadRegularCandidates();

  /* ── 진단 ── */
  if (!send) {
    return out({
      ok: true, mode: "diagnostic", email,
      member: member ? {
        id: member.id, name: member.name, phoneMasked: mask(member.phone), donorType: member.donorType,
        agreeSms: member.agreeSms, agreeEmail: member.agreeEmail,
        phoneVerified: !!member.phoneVerifiedAt, kakaoConsent: !!member.kakaoConsent,
      } : null,
      journey: journey ? { id: journey.id, name: journey.name } : null,
      candidateCount: candidates.length,
      candidates: candidates.map((c: any, i: number) => ({
        seq: i, kind: c.kind, when: c.when, channel: c.channel, tplName: c.tplName,
        preview: String(c.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80),
      })),
      hint: "발송: ?secret=<INTERNAL_TRIGGER_SECRET>&email=...&seq=0&send=1 (seq 0,1,2를 60초 간격 호출)",
    });
  }

  /* ── 실행: 시크릿 인증 ── */
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (!expected || secret !== expected) return out({ ok: false, error: "시크릿 불일치" }, 403);
  if (!member) return out({ ok: false, error: `회원 없음: ${email}` }, 404);
  const cand = candidates[seq];
  if (!cand) return out({ ok: false, error: `후보 없음 seq=${seq} (총 ${candidates.length})` }, 400);

  const data = buildMemberRenderData({ id: member.id, name: member.name, email: member.email, phone: member.phone });
  const vars: any[] = Array.isArray(cand.variables) ? cand.variables : [];
  let smsText = renderTemplate(String(cand.body || ""), vars, data).rendered;
  smsText = String(smsText).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  smsText += `\n\n[무료수신거부] ${unsubUrl(BASE_URL, member.id, "sms")}`;

  const result: any = { seq, when: cand.when, channel: cand.channel, tplName: cand.tplName, sent: {} };
  const phone = String(member.phone || "").replace(/[^0-9]/g, "");

  /* 1차 채널: kakao면 실제 우회 라우팅(현재 알림톡 검수중→문자 강등), 그 외 문자 직접 */
  try {
    if (cand.channel === "kakao") {
      const r = await sendNurtureKakao([{ member_id: member.id }], Number(cand.tplId), `테스트 ${cand.when}`);
      result.sent.primary = { channel: "kakao(우회)", ok: r.ok, viaAlimtalk: r.viaAlimtalk, note: r.viaAlimtalk ? "알림톡 발송" : "검수중→문자 강등" };
    } else if (phone.length >= 10) {
      const r = await solapiSendSms({ receiver: phone, msg: smsText, title: "교사유가족협의회 소식" });
      result.sent.primary = { channel: "sms", ok: r.ok, error: r.error };
    } else {
      result.sent.primary = { channel: cand.channel, ok: false, error: "전화번호 없음" };
    }
  } catch (e: any) { result.sent.primary = { ok: false, error: String(e?.message || e).slice(0, 200) }; }

  /* 인앱 알림함(B안) */
  try {
    const inappText = renderTemplate(String(cand.body || ""), vars, data).rendered.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 480);
    const nid = await createNotification({ recipientId: member.id, recipientType: "user", category: "donation", severity: "info",
      title: "교사유가족협의회 소식이 도착했어요", message: inappText, link: "/mypage.html#notifications" });
    result.sent.inapp = { ok: nid != null, id: nid };
  } catch (e: any) { result.sent.inapp = { ok: false, error: String(e?.message || e).slice(0, 200) }; }

  /* 보조 메일(있으면) */
  const emailTplId = cand.emailTplId ? Number(cand.emailTplId) : null;
  if (emailTplId && member.agreeEmail !== false && member.email) {
    try {
      const et = rows(await db.execute(sql`SELECT subject, body_template AS body, variables FROM communication_templates WHERE id = ${emailTplId} LIMIT 1`))[0];
      if (et) {
        const ev: any[] = Array.isArray(et.variables) ? et.variables : [];
        const subj = et.subject ? renderTemplate(String(et.subject), ev, data).rendered : "교사유가족협의회 소식";
        let html = renderTemplate(String(et.body || ""), ev, data).rendered;
        html += `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #eee;font-size:11px;color:#9aa0a8;text-align:center">교사유가족협의회 · <a href="${unsubUrl(BASE_URL, member.id, "email")}" style="color:#9aa0a8">수신거부</a></div>`;
        const m = await sendEmail({ to: member.email, subject: `[테스트] ${subj}`, html });
        result.sent.email = { ok: !!m.ok, to: member.email };
      } else { result.sent.email = { ok: false, error: "메일 템플릿 없음" }; }
    } catch (e: any) { result.sent.email = { ok: false, error: String(e?.message || e).slice(0, 200) }; }
  }

  result.smsPreview = smsText.slice(0, 200);
  return out({ ok: true, ...result });
};
