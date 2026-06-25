/**
 * migrate-nurture-channels — 너처링 채널 전환(문자 1차·메일 보조) (1회용·멱등)
 *
 * 1) nurture_steps / nurture_evergreen_rules 에 email_template_id 컬럼 추가
 * 2) 문자(SMS) 템플릿 생성(짧은 평문)
 * 3) 기존 여정(예비-일시·정기·이탈) 단계·영구를 문자 1차 + 기존 메일을 보조로 재채널
 * 4) 잠재(potential) 여정 문자 단계 + 월간 영구 시드
 *
 * 인증: 어드민 OR ?secret=. GET ?run=1. 여정 OFF 유지. 호출 후 삭제.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-nurture-channels" };
const H = { "Content-Type": "application/json; charset=utf-8" };
const L = "https://tbfa.co.kr/donate.html";
const SIG = " -교사유가족협의회";

/* 문자(SMS) 템플릿 — 짧은 평문. 수신거부 문구는 발송 시 자동 부착. */
const SMS: Record<string, { name: string; body: string }> = {
  po_d2:  { name: "[너처링·문자] 예비-일시 D+2", body: `{{이름}}님, 따뜻한 후원 감사합니다. 보내주신 마음이 교사 유가족분들께 큰 힘이 됩니다. 변화의 이야기를 계속 전해드릴게요.${SIG}` },
  po_d7:  { name: "[너처링·문자] 예비-일시 D+7", body: `{{이름}}님, "혼자가 아니라는 걸 알게 됐어요" — 후원으로 도움받은 한 유가족의 말입니다. 함께해 주셔서 감사합니다.${SIG}` },
  po_d14: { name: "[너처링·문자] 예비-일시 D+14", body: `{{이름}}님, 매월 1만원 정기후원으로 유가족 지원을 꾸준히 이어갈 수 있습니다. 함께해 주시겠어요? ▶ ${L}${SIG}` },
  po_d30: { name: "[너처링·문자] 예비-일시 D+30", body: `{{이름}}님, 정기후원은 언제든 해지 가능하고 사용 내역을 투명하게 전해드립니다. 작은 정성이 큰 힘이 됩니다 ▶ ${L}${SIG}` },
  reg_d0: { name: "[너처링·문자] 정기 D0", body: `{{이름}}님, 정기후원에 함께해 주셔서 깊이 감사드립니다. 후원이 만드는 변화를 투명하게 전해드리겠습니다.${SIG}` },
  lp_d0:  { name: "[너처링·문자] 이탈 D0", body: `{{이름}}님, 그동안의 후원 감사합니다. 혹시 결제 문제로 중단되셨다면 다시 이어가실 수 있어요 ▶ ${L}${SIG}` },
  lp_d30: { name: "[너처링·문자] 이탈 D30", body: `{{이름}}님이 함께한 시간이 유가족분들께 큰 힘이었습니다. 다시 함께해 주시겠어요? ▶ ${L}${SIG}` },
  lp_d60: { name: "[너처링·문자] 이탈 D60", body: `{{이름}}님, 지금이 아니어도 괜찮습니다. 마음을 늘 기억하겠습니다. 언제든 문은 열려 있습니다.${SIG}` },
  ev_q:   { name: "[너처링·문자] 분기 소식", body: `{{이름}}님, 교사유가족협의회 분기 소식을 전합니다. 늘 함께해 주셔서 감사합니다.${SIG}` },
  pt_d0:  { name: "[너처링·문자] 잠재 D0", body: `{{이름}}님, 교사유가족협의회입니다. 함께해 주셔서 감사합니다. 우리가 하는 일을 차차 전해드릴게요.${SIG}` },
  pt_d4:  { name: "[너처링·문자] 잠재 D4", body: `{{이름}}님, 한 유가족이 다시 일어선 이야기를 전합니다. 작은 관심이 회복의 시작입니다.${SIG}` },
  pt_d10: { name: "[너처링·문자] 잠재 D10", body: `{{이름}}님, 교사 유가족분들이 겪는 현실과 우리의 활동을 전합니다. 함께 관심 가져주셔서 감사합니다.${SIG}` },
  pt_d18: { name: "[너처링·문자] 잠재 D18", body: `{{이름}}님, 후원 외에도 함께할 수 있는 방법(행사·서명·나눔)이 있습니다. 참여해 주시면 큰 힘이 됩니다.${SIG}` },
  pt_d26: { name: "[너처링·문자] 잠재 D26", body: `{{이름}}님, 1만원의 후원이 한 가정의 회복을 함께합니다. 첫 후원으로 함께해 주시겠어요? ▶ ${L}${SIG}` },
  pt_ev:  { name: "[너처링·문자] 잠재 월간소식", body: `{{이름}}님, 교사유가족협의회 이번 달 소식을 전합니다. 관심 가져주셔서 감사합니다.${SIG}` },
};

const RECHANNEL: Record<string, Array<{ day: number; sms: string }>> = {
  prospect_onetime:   [{ day: 2, sms: "po_d2" }, { day: 7, sms: "po_d7" }, { day: 14, sms: "po_d14" }, { day: 30, sms: "po_d30" }],
  regular:            [{ day: 0, sms: "reg_d0" }],
  prospect_cancelled: [{ day: 0, sms: "lp_d0" }, { day: 30, sms: "lp_d30" }, { day: 60, sms: "lp_d60" }],
};
const POT_STEPS = [{ day: 0, sms: "pt_d0", label: "D0 환영" }, { day: 4, sms: "pt_d4", label: "D4 사례" }, { day: 10, sms: "pt_d10", label: "D10 공감" }, { day: 18, sms: "pt_d18", label: "D18 참여" }, { day: 26, sms: "pt_d26", label: "D26 첫 후원 권유" }];

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") || "";
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  let authed = expected !== "" && secret === expected;
  if (!authed) { const a = await requireAdmin(req); if (!a.ok) return (a as any).res; authed = true; }
  if (url.searchParams.get("run") !== "1") {
    return new Response(JSON.stringify({ ok: true, mode: "진단", note: "?run=1 로 실행", smsTemplates: Object.keys(SMS).length }, null, 2), { status: 200, headers: H });
  }

  try {
    /* 1) 컬럼 추가 */
    await db.execute(sql`ALTER TABLE nurture_steps ADD COLUMN IF NOT EXISTS email_template_id INTEGER`);
    await db.execute(sql`ALTER TABLE nurture_evergreen_rules ADD COLUMN IF NOT EXISTS email_template_id INTEGER`);

    /* 2) 문자 템플릿 생성(중복 skip) + id 매핑 */
    const smsId: Record<string, number> = {};
    for (const k of Object.keys(SMS)) {
      const t = SMS[k];
      await db.execute(sql`
        INSERT INTO communication_templates (name, channel, category, subject, body_template, variables, is_active)
        SELECT ${t.name}, 'sms', 'nurture', NULL, ${t.body}, '[]'::jsonb, true
        WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE name = ${t.name})`);
      const r: any = await db.execute(sql`SELECT id FROM communication_templates WHERE name = ${t.name} ORDER BY id LIMIT 1`);
      smsId[k] = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    }

    /* 여정 id */
    const jr: any = await db.execute(sql`SELECT id, segment FROM nurture_journeys`);
    const jid: Record<string, number> = {};
    for (const x of (jr?.rows ?? jr ?? [])) jid[String(x.segment)] = Number(x.id);

    let rechanneled = 0;
    /* 3) 기존 단계 재채널: 메일→보조, 문자→1차 (channel<>'sms'인 것만) */
    for (const seg of Object.keys(RECHANNEL)) {
      const j = jid[seg]; if (!j) continue;
      for (const st of RECHANNEL[seg]) {
        const sid = smsId[st.sms]; if (!sid) continue;
        const up: any = await db.execute(sql`
          UPDATE nurture_steps
             SET email_template_id = CASE WHEN channel = 'email' THEN template_id ELSE email_template_id END,
                 template_id = ${sid}, channel = 'sms', updated_at = NOW()
           WHERE journey_id = ${j} AND day_offset = ${st.day} AND channel <> 'sms'`);
        rechanneled += Number((up as any)?.rowCount ?? (up as any)?.count ?? 0);
      }
    }
    /* 영구(분기) 재채널 — 기존 메일을 보조로, ev_q 문자를 1차로 */
    let evRechanneled = 0;
    for (const seg of ["prospect_onetime", "regular", "prospect_cancelled"]) {
      const j = jid[seg]; if (!j) continue;
      const up: any = await db.execute(sql`
        UPDATE nurture_evergreen_rules
           SET email_template_id = CASE WHEN channel = 'email' THEN template_id ELSE email_template_id END,
               template_id = ${smsId["ev_q"]}, channel = 'sms', updated_at = NOW()
         WHERE journey_id = ${j} AND cadence = 'quarterly' AND channel <> 'sms'`);
      evRechanneled += Number((up as any)?.rowCount ?? (up as any)?.count ?? 0);
    }

    /* 4) 잠재 여정 문자 단계 + 월간 영구 시드 */
    let potSteps = 0;
    const pj = jid["potential"];
    if (pj) {
      for (const st of POT_STEPS) {
        const sid = smsId[st.sms]; if (!sid) continue;
        const ins: any = await db.execute(sql`
          INSERT INTO nurture_steps (journey_id, day_offset, channel, template_id, label, sort_order, is_active)
          SELECT ${pj}, ${st.day}, 'sms', ${sid}, ${st.label}, ${st.day}, true
          WHERE NOT EXISTS (SELECT 1 FROM nurture_steps WHERE journey_id = ${pj} AND day_offset = ${st.day})
          RETURNING id`);
        if ((ins?.rows ?? ins ?? []).length > 0) potSteps++;
      }
      await db.execute(sql`
        INSERT INTO nurture_evergreen_rules (journey_id, cadence, channel, template_id, label, is_active)
        SELECT ${pj}, 'monthly', 'sms', ${smsId["pt_ev"]}, '월간 소식', true
        WHERE NOT EXISTS (SELECT 1 FROM nurture_evergreen_rules WHERE journey_id = ${pj} AND cadence = 'monthly')`);
    }

    const chk: any = await db.execute(sql`
      SELECT j.segment, s.day_offset, s.channel, s.template_id, s.email_template_id
      FROM nurture_steps s JOIN nurture_journeys j ON j.id = s.journey_id ORDER BY j.segment, s.day_offset`);
    return new Response(JSON.stringify({ ok: true, mode: "전환완료", smsTemplates: Object.keys(smsId).length, rechanneled, evRechanneled, potSteps, steps: (chk?.rows ?? chk ?? []), note: "여정 OFF 유지" }, null, 2), { status: 200, headers: H });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: "전환 실패", detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 800) }), { status: 500, headers: H });
  }
}
