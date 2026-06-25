/**
 * migrate-nurture-potential-email — 잠재 여정 보조 메일 템플릿 (1회용·멱등)
 * 잠재 단계(D0/4/10/18/26)에 이메일 있는 리드용 보조 HTML 메일 연결.
 * 인증: 어드민 OR ?secret=. GET ?run=1. 호출 후 삭제.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-nurture-potential-email" };
const H = { "Content-Type": "application/json; charset=utf-8" };
const L = "https://tbfa.co.kr/donate.html";
const SIG = `<p>— 교사유가족협의회 드림</p>`;
const BTN = (t: string) => `<p><a href="${L}" style="display:inline-block;padding:12px 22px;background:#7a1f2b;color:#fff;border-radius:8px;text-decoration:none">${t}</a></p>`;

const TPLS: Array<{ day: number; name: string; subject: string; body: string }> = [
  { day: 0,  name: "[너처링·메일] 잠재 D0 환영", subject: "{{이름}}님, 교사유가족협의회입니다",
    body: `<p>{{이름}}님, 관심 가져주셔서 감사합니다.</p><p>저희는 교사 유가족분들의 회복을 함께하는 단체입니다. 앞으로 저희가 하는 일을 차차 전해드리겠습니다.</p>${SIG}` },
  { day: 4,  name: "[너처링·메일] 잠재 D4 사례", subject: "한 유가족이 다시 일어선 이야기",
    body: `<p>{{이름}}님, 한 유가족이 다시 일상을 찾은 이야기를 전합니다.</p><p>작은 관심이 회복의 시작이 됩니다. 함께 지켜봐 주세요.</p>${SIG}` },
  { day: 10, name: "[너처링·메일] 잠재 D10 공감", subject: "왜 지금 이 일이 필요할까요",
    body: `<p>{{이름}}님, 교사 유가족분들이 겪는 현실과 저희의 활동을 전합니다.</p><p>함께 관심 가져주셔서 진심으로 감사합니다.</p>${SIG}` },
  { day: 18, name: "[너처링·메일] 잠재 D18 참여", subject: "함께할 수 있는 방법이 있습니다",
    body: `<p>{{이름}}님, 후원 외에도 행사·서명·나눔 등 함께할 수 있는 방법이 있습니다.</p><p>작은 참여가 큰 힘이 됩니다.</p>${SIG}` },
  { day: 26, name: "[너처링·메일] 잠재 D26 첫 후원", subject: "{{이름}}님의 첫 후원이 큰 변화가 됩니다",
    body: `<p>{{이름}}님, 1만원의 후원이 한 가정의 회복을 함께합니다.</p><p>첫 후원으로 함께해 주시겠어요?</p>${BTN("첫 후원 함께하기")}${SIG}` },
];

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") || "";
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  let authed = expected !== "" && secret === expected;
  if (!authed) { const a = await requireAdmin(req); if (!a.ok) return (a as any).res; authed = true; }
  if (url.searchParams.get("run") !== "1") {
    return new Response(JSON.stringify({ ok: true, mode: "진단", templates: TPLS.length }, null, 2), { status: 200, headers: H });
  }

  try {
    const jr: any = await db.execute(sql`SELECT id FROM nurture_journeys WHERE segment = 'potential' LIMIT 1`);
    const pj = Number((jr?.rows ?? jr ?? [])[0]?.id) || 0;
    if (!pj) return new Response(JSON.stringify({ ok: false, error: "potential 여정 없음" }), { status: 400, headers: H });

    let linked = 0;
    for (const t of TPLS) {
      await db.execute(sql`
        INSERT INTO communication_templates (name, channel, category, subject, body_template, variables, is_active)
        SELECT ${t.name}, 'email', 'nurture', ${t.subject}, ${t.body}, '[]'::jsonb, true
        WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE name = ${t.name})`);
      const tr: any = await db.execute(sql`SELECT id FROM communication_templates WHERE name = ${t.name} ORDER BY id LIMIT 1`);
      const tid = Number((tr?.rows ?? tr ?? [])[0]?.id) || 0;
      if (!tid) continue;
      const up: any = await db.execute(sql`
        UPDATE nurture_steps SET email_template_id = ${tid}, updated_at = NOW()
        WHERE journey_id = ${pj} AND day_offset = ${t.day} AND email_template_id IS NULL`);
      linked += Number((up as any)?.rowCount ?? (up as any)?.count ?? 0);
    }
    const chk: any = await db.execute(sql`SELECT day_offset, channel, template_id, email_template_id FROM nurture_steps WHERE journey_id = ${pj} ORDER BY day_offset`);
    return new Response(JSON.stringify({ ok: true, mode: "완료", linked, steps: (chk?.rows ?? chk ?? []) }, null, 2), { status: 200, headers: H });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: "실패", detail: String(err?.message || err).slice(0, 500) }), { status: 500, headers: H });
  }
}
