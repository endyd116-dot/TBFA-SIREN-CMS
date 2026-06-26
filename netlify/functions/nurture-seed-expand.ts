/**
 * nurture-seed-expand — 1회용: 365일 너처링 콘텐츠 보강(기존 유지·추가만).
 * 잠재/예비/정기의 중후반 터치를 모범사례 기반으로 추가(과빈도 회피·구체적·따뜻한 톤).
 * GET ?secret=..&run=1 → 멱등(이미 있는 day_offset 건너뜀). 호출 후 삭제(1회용).
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/nurture-seed-expand" };
const H = { "Content-Type": "application/json; charset=utf-8" };
function out(o: object, s = 200) { return new Response(JSON.stringify(o, null, 2), { status: s, headers: H }); }
function rows(r: any): any[] { return (r?.rows ?? r ?? []) as any[]; }
const VARS = JSON.stringify([{ key: "이름", label: "회원이름", sample: "김후원" }]);

const ADD: Record<string, Array<{ d: number; label: string; sms: string }>> = {
  potential: [
    { d: 45, label: "잠재 D45 · 합격 스토리", sms: "{{이름}}님, 지난달 한 고등학생은 아버지를 잃은 뒤에도 저희 장학으로 학업을 이어가 원하던 대학에 합격했습니다. {{이름}}님이 보내주실 관심이 이런 내일을 만듭니다. 오늘도 고맙습니다." },
    { d: 90, label: "잠재 D90 · 캠페인 초대", sms: "{{이름}}님, 곧 협의회의 작은 나눔 캠페인이 열립니다. 부담 없이 마음 보태주실 수 있다면 한 가족에게 큰 힘이 됩니다. 자세한 소식 곧 전해드릴게요. 늘 감사합니다." },
    { d: 150, label: "잠재 D150 · 투명 보고", sms: "{{이름}}님, 올 한 해 저희는 더 많은 유가족께 상담·법률·장학의 손길을 전할 수 있었습니다. 작은 정성이 모여 만든 변화입니다. 그 걸음을 투명하게 계속 알려드릴게요." },
    { d: 250, label: "잠재 D250 · 용기 스토리", sms: "{{이름}}님, 한 어머니는 ‘세상에 혼자 남은 줄 알았는데 곁을 지켜주는 분들이 있어 다시 살아갈 용기를 냈다’고 하셨습니다. {{이름}}님의 관심이 그 용기의 시작입니다. 고맙습니다." },
    { d: 365, label: "잠재 D365 · 1년 인사", sms: "{{이름}}님, 저희 소식을 함께 들어주신 지 1년이 되었습니다. 그 관심만으로도 큰 힘이었어요. 언젠가 작은 나눔으로 함께해 주신다면 더없이 감사하겠습니다. 늘 평안하세요." },
  ],
  prospect_onetime: [
    { d: 120, label: "일시 D120 · 전환 스토리", sms: "{{이름}}님, 한 번의 후원으로 시작해 지금은 매달 함께해 주시는 분이 ‘작지만 꾸준한 나눔이 가장 보람 있다’고 하셨어요. {{이름}}께도 그 따뜻한 동행을 살며시 권해봅니다. 부담 없으실 때 생각해 주세요." },
    { d: 180, label: "일시 D180 · 반기 감사", sms: "{{이름}}님, 지난 반년 동안 {{이름}}님 같은 분들의 마음이 모여 여러 가족이 다시 일어섰습니다. 함께해 주셔서 진심으로 감사드립니다. 그 변화를 앞으로도 전해드릴게요." },
    { d: 270, label: "일시 D270 · 전환 재초대", sms: "{{이름}}님, 매달 작은 정기후원은 한 가족 곁을 ‘끊기지 않게’ 지켜줍니다. 언제든 마음이 닿으실 때 함께해 주시면 큰 힘이 되겠습니다. 늘 감사한 마음입니다." },
    { d: 365, label: "일시 D365 · 1년 감사", sms: "{{이름}}님, 함께해 주신 지 1년이네요. {{이름}}님의 따뜻한 한 걸음이 누군가에겐 다시 살아갈 힘이었습니다. 새해에는 매달의 작은 동행으로도 곁에 있어 주시면 더없이 감사하겠습니다." },
  ],
  prospect_cancelled: [
    { d: 120, label: "이탈 D120 · 안부", sms: "{{이름}}님, 그동안 협의회에는 따뜻한 변화가 이어지고 있어요. {{이름}}님이 남겨주신 마음도 그 안에 함께 있습니다. 문득 안부를 전하고 싶었어요. 늘 평안하세요." },
    { d: 240, label: "이탈 D240 · 재초대", sms: "{{이름}}님, 혹시 다시 한 번 유가족의 곁을 함께 지켜주실 수 있을까요? 예전처럼 부담 없는 작은 나눔이면 충분합니다. 언제든 마음 내키실 때 반갑게 맞이하겠습니다." },
  ],
  regular: [
    { d: 14, label: "정기 D14 · 안심 점검", sms: "{{이름}}님, 후원 잘 시작되셨는지요. 혹시 불편하거나 궁금한 점 있으시면 언제든 편히 말씀해 주세요. {{이름}}님의 마음이 잘 전해지도록 늘 살피겠습니다. 감사합니다." },
    { d: 45, label: "정기 D45 · 현장 이야기", sms: "{{이름}}님, 오늘은 현장 이야기를 전합니다. {{이름}}님의 후원으로 한 가족이 법률 상담을 받고 한시름 놓으셨어요. 곁에서 함께해 주셔서 고맙습니다." },
    { d: 120, label: "정기 D120 · 구체 임팩트", sms: "{{이름}}님, 넉 달째 함께해 주셔서 감사합니다. 그동안 {{이름}}님의 후원은 상담실의 불을 켜고, 한 아이의 책상을 지켰습니다. 그 꾸준함이 가장 큰 힘입니다." },
    { d: 210, label: "정기 D210 · 외롭지 않게", sms: "{{이름}}님, 한 유가족은 ‘매달 잊지 않고 함께해 주는 분들 덕에 외롭지 않다’고 하셨습니다. {{이름}}님이 바로 그분들 중 한 분이세요. 진심으로 감사드립니다." },
    { d: 300, label: "정기 D300 · 한 해 돌아보기", sms: "{{이름}}님, 한 해가 저물어 갑니다. 올 한 해 {{이름}}님과 함께 걸어 더 많은 가족이 봄을 맞았습니다. 남은 시간도, 새해에도 변함없이 곁을 지키겠습니다." },
  ],
};

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (url.searchParams.get("run") !== "1") return out({ ok: true, mode: "diagnostic", add: Object.fromEntries(Object.entries(ADD).map(([k, v]) => [k, v.length])) });
  if (!process.env.INTERNAL_TRIGGER_SECRET || url.searchParams.get("secret") !== process.env.INTERNAL_TRIGGER_SECRET) return out({ ok: false, error: "시크릿 불일치" }, 403);

  const result: any = {};
  try {
    for (const [segment, list] of Object.entries(ADD)) {
      const j = rows(await db.execute(sql`SELECT id FROM nurture_journeys WHERE segment = ${segment} ORDER BY id LIMIT 1`))[0];
      if (!j) { result[segment] = "여정 없음"; continue; }
      const jid = Number(j.id);
      let added = 0, skipped = 0;
      for (const st of list) {
        const has = rows(await db.execute(sql`SELECT id FROM nurture_steps WHERE journey_id=${jid} AND day_offset=${st.d} LIMIT 1`))[0];
        if (has) { skipped++; continue; }
        const name = `[너처링·문자] ${st.label}`;
        let tplId = rows(await db.execute(sql`SELECT id FROM communication_templates WHERE name=${name} LIMIT 1`))[0]?.id;
        if (!tplId) tplId = rows(await db.execute(sql`INSERT INTO communication_templates (name, channel, category, subject, body_template, variables, is_active, created_at, updated_at) VALUES (${name}, 'sms', 'nurture', NULL, ${st.sms}, ${VARS}::jsonb, true, NOW(), NOW()) RETURNING id`))[0]?.id;
        await db.execute(sql`INSERT INTO nurture_steps (journey_id, day_offset, channel, template_id, label, is_active, conditions, sort_order) VALUES (${jid}, ${st.d}, 'sms', ${tplId}, ${st.label}, true, '{}'::jsonb, ${st.d})`);
        added++;
      }
      result[segment] = { journeyId: jid, added, skipped };
    }
    return out({ ok: true, expanded: result, note: "여정은 OFF 유지" });
  } catch (e: any) {
    return out({ ok: false, error: String(e?.message || e).slice(0, 500), stack: String(e?.stack || "").slice(0, 600), partial: result }, 500);
  }
};
