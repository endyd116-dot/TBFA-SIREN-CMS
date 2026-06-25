/**
 * migrate-nurture-seed-p2 — 정기·이탈(예비-cancelled) 여정 기본 시드 (Phase 2·1회용·멱등)
 *
 * - 정기(regular): D0 환영 + 영구 분기 임팩트 리포트(non-ask)
 * - 이탈(prospect_cancelled): D0 감사+재개·결제갱신 안내 / D30 재개 권유 / D60 윈백 + 영구 분기 소식
 *   ('이탈 자동재유치' = cancelled 세그먼트 진입 자체가 트리거. 현 엔진으로 동작)
 *
 * 인증: 어드민 OR ?secret=. GET ?run=1 실행. 여정은 OFF 유지(운영자 검토 후 켬). 호출 후 삭제.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-nurture-seed-p2" };
const H = { "Content-Type": "application/json; charset=utf-8" };
const DONATE = "https://tbfa.co.kr/donate.html";

const BTN = (label: string) => `<p><a href="${DONATE}" style="display:inline-block;padding:12px 22px;background:#7a1f2b;color:#fff;border-radius:8px;text-decoration:none">${label}</a></p>`;
const SIGN = `<p>— 교사유가족협의회 드림</p>`;

/* 템플릿 (초안·운영자 편집 전제) */
const TPLS = [
  { key: "reg_welcome", name: "[너처링] 정기 D0 환영", subject: "{{이름}}님, 정기 후원의 길에 함께해 주셔서 감사합니다",
    body: `<p>{{이름}}님, 매월 함께해 주시기로 한 그 마음에 깊이 감사드립니다.</p>
<p>{{이름}}님의 꾸준한 후원은 교사 유가족분들이 회복의 길을 끝까지 걸을 수 있는 가장 든든한 힘입니다.
앞으로 후원이 어떻게 쓰이는지, 어떤 변화를 만드는지 투명하게 전해드리겠습니다.</p>${SIGN}` },
  { key: "reg_quarterly", name: "[너처링] 정기 영구 분기 리포트", subject: "{{이름}}님과 함께 만든 지난 분기의 변화",
    body: `<p>{{이름}}님, 안녕하세요.</p>
<p>지난 분기 동안 {{이름}}님과 같은 정기 후원자분들의 마음으로 이런 일들이 있었습니다. (운영자가 분기마다 임팩트 업데이트)</p>
<p>늘 함께해 주셔서 감사합니다. 오늘도 따뜻한 하루 되세요.</p>${SIGN}` },

  { key: "lapse_thanks", name: "[너처링] 이탈 D0 감사+재개안내", subject: "{{이름}}님, 그동안의 따뜻한 마음에 감사드립니다",
    body: `<p>{{이름}}님, 그동안 보내주신 후원에 진심으로 감사드립니다.</p>
<p>혹시 카드 만료나 결제 문제로 후원이 중단되셨다면, 아래에서 간단히 다시 이어가실 수 있습니다.
부담 없이 언제든 결정하셔도 괜찮습니다.</p>${BTN("후원 다시 이어가기")}
<p>더 나은 방향을 위해 의견이 있으시면 언제든 편히 들려주세요.</p>${SIGN}` },
  { key: "lapse_reengage", name: "[너처링] 이탈 D30 재개 권유", subject: "{{이름}}님이 함께한 시간이 만든 변화",
    body: `<p>{{이름}}님, 잘 지내고 계신가요?</p>
<p>{{이름}}님께서 함께해 주신 동안 유가족분들께 이런 회복의 순간들이 있었습니다.
다시 함께해 주신다면 그 길을 계속 이어갈 수 있습니다.</p>${BTN("다시 함께하기")}${SIGN}` },
  { key: "lapse_winback", name: "[너처링] 이탈 D60 윈백", subject: "언제든 문은 열려 있습니다, {{이름}}님",
    body: `<p>{{이름}}님, 마지막으로 한 번 더 안부 전합니다.</p>
<p>지금이 아니어도 괜찮습니다. {{이름}}님의 마음을 늘 기억하겠습니다.
언젠가 다시 함께하고 싶으실 때, 문은 항상 열려 있습니다.</p>${BTN("후원 다시 시작하기")}${SIGN}` },
  { key: "lapse_quarterly", name: "[너처링] 이탈 영구 분기 소식", subject: "교사유가족협의회 소식을 전합니다",
    body: `<p>{{이름}}님, 그간 잘 지내셨나요? 협의회의 분기 소식을 전합니다. (운영자가 분기마다 업데이트)</p>
<p>늘 건강하시길 바랍니다.</p>${SIGN}` },
];

/* 여정별 단계·영구규칙 */
const PLAN: Record<string, { steps: any[]; evergreen: any[] }> = {
  regular: {
    steps: [{ day: 0, ch: "email", key: "reg_welcome", label: "D0 환영", sort: 0 }],
    evergreen: [{ cadence: "quarterly", ch: "email", key: "reg_quarterly", label: "분기 임팩트 리포트" }],
  },
  prospect_cancelled: {
    steps: [
      { day: 0,  ch: "email", key: "lapse_thanks",   label: "D0 감사+재개 안내", sort: 0 },
      { day: 30, ch: "email", key: "lapse_reengage", label: "D30 재개 권유",    sort: 1 },
      { day: 60, ch: "email", key: "lapse_winback",  label: "D60 윈백",        sort: 2 },
    ],
    evergreen: [{ cadence: "quarterly", ch: "email", key: "lapse_quarterly", label: "분기 소식" }],
  },
};

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") || "";
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  let authed = expected !== "" && secret === expected;
  if (!authed) { const a = await requireAdmin(req); if (!a.ok) return (a as any).res; authed = true; }
  const run = url.searchParams.get("run") === "1";

  try {
    const segs = Object.keys(PLAN);
    const jr: any = await db.execute(sql`SELECT id, segment FROM nurture_journeys WHERE segment = ANY(${sql.raw(`ARRAY['${segs.join("','")}']`)})`);
    const journeyBySeg: Record<string, number> = {};
    for (const r of (jr?.rows ?? jr ?? [])) journeyBySeg[String(r.segment)] = Number(r.id);

    if (!run) {
      return new Response(JSON.stringify({ ok: true, mode: "진단", journeyBySeg, willSeed: { templates: TPLS.length } }, null, 2), { status: 200, headers: H });
    }

    /* 템플릿 INSERT(중복 skip) + id 매핑 */
    const idByKey: Record<string, number> = {};
    for (const t of TPLS) {
      await db.execute(sql`
        INSERT INTO communication_templates (name, channel, category, subject, body_template, variables, is_active)
        SELECT ${t.name}, 'email', 'nurture', ${t.subject}, ${t.body}, '[]'::jsonb, true
        WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE name = ${t.name})`);
      const r: any = await db.execute(sql`SELECT id FROM communication_templates WHERE name = ${t.name} ORDER BY id LIMIT 1`);
      idByKey[t.key] = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    }

    let stepsInserted = 0, evInserted = 0;
    for (const seg of segs) {
      const jid = journeyBySeg[seg];
      if (!jid) continue;
      for (const st of PLAN[seg].steps) {
        const tid = idByKey[st.key]; if (!tid) continue;
        const ins: any = await db.execute(sql`
          INSERT INTO nurture_steps (journey_id, day_offset, channel, template_id, label, sort_order, is_active)
          SELECT ${jid}, ${st.day}, ${st.ch}, ${tid}, ${st.label}, ${st.sort}, true
          WHERE NOT EXISTS (SELECT 1 FROM nurture_steps WHERE journey_id = ${jid} AND day_offset = ${st.day})
          RETURNING id`);
        if ((ins?.rows ?? ins ?? []).length > 0) stepsInserted++;
      }
      for (const ev of PLAN[seg].evergreen) {
        const tid = idByKey[ev.key]; if (!tid) continue;
        const ins: any = await db.execute(sql`
          INSERT INTO nurture_evergreen_rules (journey_id, cadence, channel, template_id, label, is_active)
          SELECT ${jid}, ${ev.cadence}, ${ev.ch}, ${tid}, ${ev.label}, true
          WHERE NOT EXISTS (SELECT 1 FROM nurture_evergreen_rules WHERE journey_id = ${jid} AND cadence = ${ev.cadence})
          RETURNING id`);
        if ((ins?.rows ?? ins ?? []).length > 0) evInserted++;
      }
    }

    const chk: any = await db.execute(sql`
      SELECT j.segment, s.day_offset, s.label FROM nurture_steps s JOIN nurture_journeys j ON j.id = s.journey_id
      WHERE j.segment = ANY(${sql.raw(`ARRAY['${segs.join("','")}']`)}) ORDER BY j.segment, s.day_offset`);
    return new Response(JSON.stringify({ ok: true, mode: "시드완료", templates: Object.keys(idByKey).length, stepsInserted, evInserted, steps: (chk?.rows ?? chk ?? []), note: "여정 OFF 유지 — 어드민에서 검토 후 켜세요." }, null, 2), { status: 200, headers: H });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: "시드 실패", detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 800) }), { status: 500, headers: H });
  }
}
