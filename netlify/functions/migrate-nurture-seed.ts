/**
 * migrate-nurture-seed — 예비-일시→정기 전환 여정 기본 시드 (Phase 1·1회용·멱등)
 *
 * - communication_templates 에 너처링 메일 5종(운영자 편집 가능) INSERT(중복 시 skip)
 * - nurture_steps: 예비-일시 여정에 D+2/D+7/D+14/D+30 단계
 * - nurture_evergreen_rules: 분기 소식
 *
 * 인증: 어드민 OR ?secret=<INTERNAL_TRIGGER_SECRET>.  GET ?run=1 실행.
 * 여정은 여전히 OFF — 시드만. 운영자가 검토 후 켬. 호출·확인 후 삭제.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-nurture-seed" };
const H = { "Content-Type": "application/json; charset=utf-8" };

const DONATE_URL = "https://tbfa.co.kr/donate.html";

/* 너처링 메일 템플릿 (초안 — 운영자 편집 전제) */
const TPLS = [
  {
    key: "impact",
    name: "[너처링] 예비-일시 D+2 임팩트",
    subject: "{{이름}}님의 후원이 만든 변화",
    body: `<p>{{이름}}님, 따뜻한 후원 진심으로 감사드립니다.</p>
<p>{{이름}}님께서 보내주신 마음은 교사 유가족분들이 다시 일어설 수 있는 든든한 버팀목이 됩니다.
한 분 한 분의 후원이 모여 심리 상담·법률 지원·장학의 손길로 이어집니다.</p>
<p>앞으로 그 변화의 이야기를 {{이름}}님께 계속 전해드리겠습니다.</p>
<p>— 교사유가족협의회 드림</p>`,
  },
  {
    key: "voice",
    name: "[너처링] 예비-일시 D+7 유족 후기",
    subject: "한 유가족이 전한 감사의 말",
    body: `<p>{{이름}}님께,</p>
<p>“혼자가 아니라는 것을 알게 됐습니다.” 후원으로 도움을 받은 한 유가족분이 전한 말입니다.</p>
<p>{{이름}}님의 후원이 이런 회복의 순간을 만들고 있습니다. 진심으로 감사합니다.</p>
<p>— 교사유가족협의회 드림</p>`,
  },
  {
    key: "convert",
    name: "[너처링] 예비-일시 D+14 정기 전환 권유",
    subject: "매월 작은 정성으로 함께해 주시겠어요?",
    body: `<p>{{이름}}님, 그동안의 따뜻한 관심에 감사드립니다.</p>
<p>매월 1만원의 정기 후원은 유가족 지원을 <strong>꾸준히</strong> 이어갈 수 있는 가장 큰 힘이 됩니다.
한 달 커피 두 잔이 한 가정의 회복 여정을 함께합니다.</p>
<p><a href="${DONATE_URL}" style="display:inline-block;padding:12px 22px;background:#7a1f2b;color:#fff;border-radius:8px;text-decoration:none">매월 정기 후원 시작하기</a></p>
<p>{{이름}}님과 오래 함께하고 싶습니다.</p>
<p>— 교사유가족협의회 드림</p>`,
  },
  {
    key: "nudge",
    name: "[너처링] 예비-일시 D+30 정기 전환 2차",
    subject: "{{이름}}님의 한 걸음이 큰 변화가 됩니다",
    body: `<p>{{이름}}님, 다시 한번 안부 전합니다.</p>
<p>정기 후원은 언제든 해지할 수 있고, 매달 후원이 어떻게 쓰였는지 투명하게 전해드립니다.
{{이름}}님의 꾸준한 마음이 유가족분들께는 가장 큰 위로입니다.</p>
<p><a href="${DONATE_URL}" style="display:inline-block;padding:12px 22px;background:#7a1f2b;color:#fff;border-radius:8px;text-decoration:none">매월 정기 후원 함께하기</a></p>
<p>— 교사유가족협의회 드림</p>`,
  },
  {
    key: "quarterly",
    name: "[너처링] 예비-일시 영구 분기 소식",
    subject: "교사유가족협의회 분기 소식을 전합니다",
    body: `<p>{{이름}}님, 그간 잘 지내셨나요?</p>
<p>지난 분기 동안 {{이름}}님과 같은 후원자분들의 마음으로 이런 일들이 있었습니다. (운영자가 분기마다 내용 업데이트)</p>
<p>언제나 함께해 주셔서 감사합니다.</p>
<p>— 교사유가족협의회 드림</p>`,
  },
];

/* 단계 (D0 감사·영수증은 후원 완료 흐름이 이미 발송 → 너처링은 D+2부터) */
const STEPS = [
  { day: 2,  ch: "email", key: "impact",  label: "D+2 임팩트 스토리",   sort: 1 },
  { day: 7,  ch: "email", key: "voice",   label: "D+7 유족 후기",       sort: 2 },
  { day: 14, ch: "email", key: "convert", label: "D+14 정기 전환 권유", sort: 3 },
  { day: 30, ch: "email", key: "nudge",   label: "D+30 정기 전환 2차",  sort: 4 },
];
const EVERGREEN = [{ cadence: "quarterly", ch: "email", key: "quarterly", label: "분기 소식" }];

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") || "";
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  let authed = expected !== "" && secret === expected;
  if (!authed) {
    const a = await requireAdmin(req);
    if (!a.ok) return (a as any).res;
    authed = true;
  }
  const run = url.searchParams.get("run") === "1";

  try {
    /* 여정 id */
    const jr: any = await db.execute(sql`SELECT id FROM nurture_journeys WHERE segment = 'prospect_onetime' LIMIT 1`);
    const journeyId = Number((jr?.rows ?? jr ?? [])[0]?.id) || 0;
    if (!journeyId) return new Response(JSON.stringify({ ok: false, error: "prospect_onetime 여정 없음 — migrate-nurture-schema 먼저" }), { status: 400, headers: H });

    if (!run) {
      return new Response(JSON.stringify({ ok: true, mode: "진단", journeyId, willSeed: { templates: TPLS.length, steps: STEPS.length, evergreen: EVERGREEN.length }, note: "?run=1 로 시드" }, null, 2), { status: 200, headers: H });
    }

    /* 1) 템플릿 INSERT(중복 skip) + id 매핑 */
    const idByKey: Record<string, number> = {};
    for (const t of TPLS) {
      await db.execute(sql`
        INSERT INTO communication_templates (name, channel, category, subject, body_template, variables, is_active)
        SELECT ${t.name}, 'email', 'nurture', ${t.subject}, ${t.body}, '[]'::jsonb, true
        WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE name = ${t.name})
      `);
      const r: any = await db.execute(sql`SELECT id FROM communication_templates WHERE name = ${t.name} ORDER BY id LIMIT 1`);
      idByKey[t.key] = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    }

    /* 2) 단계 INSERT(여정+day_offset 중복 skip) */
    let stepsInserted = 0;
    for (const st of STEPS) {
      const tid = idByKey[st.key];
      if (!tid) continue;
      const ins: any = await db.execute(sql`
        INSERT INTO nurture_steps (journey_id, day_offset, channel, template_id, label, sort_order, is_active)
        SELECT ${journeyId}, ${st.day}, ${st.ch}, ${tid}, ${st.label}, ${st.sort}, true
        WHERE NOT EXISTS (SELECT 1 FROM nurture_steps WHERE journey_id = ${journeyId} AND day_offset = ${st.day})
        RETURNING id
      `);
      if ((ins?.rows ?? ins ?? []).length > 0) stepsInserted++;
    }

    /* 3) 영구 규칙 INSERT(여정+cadence 중복 skip) */
    let evInserted = 0;
    for (const ev of EVERGREEN) {
      const tid = idByKey[ev.key];
      if (!tid) continue;
      const ins: any = await db.execute(sql`
        INSERT INTO nurture_evergreen_rules (journey_id, cadence, channel, template_id, label, is_active)
        SELECT ${journeyId}, ${ev.cadence}, ${ev.ch}, ${tid}, ${ev.label}, true
        WHERE NOT EXISTS (SELECT 1 FROM nurture_evergreen_rules WHERE journey_id = ${journeyId} AND cadence = ${ev.cadence})
        RETURNING id
      `);
      if ((ins?.rows ?? ins ?? []).length > 0) evInserted++;
    }

    const stepsChk: any = await db.execute(sql`SELECT day_offset, channel, label FROM nurture_steps WHERE journey_id = ${journeyId} ORDER BY day_offset`);
    return new Response(JSON.stringify({
      ok: true, mode: "시드완료", journeyId,
      templates: Object.keys(idByKey).length, stepsInserted, evInserted,
      steps: (stepsChk?.rows ?? stepsChk ?? []),
      note: "여정은 아직 OFF — 어드민에서 검토 후 켜세요.",
    }, null, 2), { status: 200, headers: H });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: "시드 실패", detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 800) }), { status: 500, headers: H });
  }
}
