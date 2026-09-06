// netlify/functions/migrate-sponsor-welcome.ts
// ★ 1회용 (2026-09-06 · Swain 지시 A안) — 호출 성공 후 파일 삭제.
//
//  ① 「후원회원 등록 안내(등불의 기적)」 알림톡 템플릿을 솔라피에 등록 + 카카오 검수 신청 + kakao_alimtalk_templates 행
//     (event_key SPONSOR_WELCOME). 승인되면 cron-kakao-template-status 가 approved 로 바꾸고, 그때부터 가입 안내가 알림톡으로 나간다.
//     승인 전에는 같은 내용이 문자(LMS)로 나간다(lib/sponsor-welcome-notice.ts).
//  ② 「등불 가입 · 미납 후속」 너처링 여정(segment sponsor_unpaid · 기본 OFF) + D+3·D+7 문자 단계 + 본문 템플릿 시드.
//     운영자가 통합 CMS 💌 후원자 너처링 › 예비 후원자 탭에서 문구를 보고 켠다.
//
// GET              : 진단(인증 불필요) — 템플릿·여정·단계 존재 여부
// GET ?run=1       : 어드민 세션으로 실행(멱등 — 있으면 건너뜀)

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { solapiListChannels, solapiCreateTemplate, solapiRequestInspection } from "../../lib/solapi-client";
import { SPONSOR_WELCOME_EVENT_KEY, SPONSOR_WELCOME_TEMPLATE } from "../../lib/sponsor-welcome-notice";

export const config = { path: "/api/migrate-sponsor-welcome" };

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];
function json(body: any, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

const JOURNEY = {
  segment: "sponsor_unpaid",
  name: "등불 가입 · 미납 후속 — 후원회원 가입 뒤 첫 회비가 없는 분께",
  entryBasis: "signup",
};

const STEPS = [
  {
    day: 3,
    label: "D+3 첫 회비 안내",
    tplName: "[너처링] 등불 가입·미납 D+3 첫 회비 안내",
    body:
      "{{이름}}님, 「등불의 기적」 후원회원 등록에 감사드립니다. 아직 첫 회비(월 1만 원부터 · 일시 후원도 가능) 납부가 확인되지 않았어요. 홈페이지에서 1분이면 마칠 수 있습니다.\n" +
      "▶ https://tbfa.co.kr/lantern/join\n" +
      "(이미 입금하셨다면 확인 후 반영되니 이 안내는 무시하셔도 됩니다)\n" +
      "— 사단법인 교사유가족협의회",
  },
  {
    day: 7,
    label: "D+7 다시 안내",
    tplName: "[너처링] 등불 가입·미납 D+7 다시 안내",
    body:
      "{{이름}}님, 선생님들의 빈자리를 함께 지키는 등불이 하나씩 켜지고 있습니다. 첫 회비를 아직 못 보내셨다면 지금 등불을 켜 주세요.\n" +
      "▶ https://tbfa.co.kr/lantern/join\n" +
      "문의 010-2807-5242 — 사단법인 교사유가족협의회",
  },
];

async function diagnose() {
  const tpl = rowsOf(await db.execute(sql`SELECT id, status, solapi_template_id AS tid, is_active FROM kakao_alimtalk_templates WHERE event_key = ${SPONSOR_WELCOME_EVENT_KEY} ORDER BY id DESC LIMIT 1`))[0] || null;
  const journey = rowsOf(await db.execute(sql`SELECT id, is_active FROM nurture_journeys WHERE segment = ${JOURNEY.segment} LIMIT 1`))[0] || null;
  const steps = journey ? Number(rowsOf(await db.execute(sql`SELECT COUNT(*)::int AS n FROM nurture_steps WHERE journey_id = ${Number(journey.id)}`))[0]?.n || 0) : 0;
  return { template: tpl, journey, steps };
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    try { return json({ ok: true, mode: "diagnose", ...(await diagnose()) }); }
    catch (e: any) { return json({ ok: false, step: "diagnose", detail: String(e?.message || e).slice(0, 300) }, 500); }
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;   /* 반환 필드는 res (code_standards #58) */
  const adminUid = Number((auth as any).ctx?.admin?.uid || 0) || null;

  const out: any = { ok: true, template: null as any, journey: null as any, steps: [] as any[], warnings: [] as string[] };

  /* ── ① 알림톡 템플릿 등록 + 검수 신청 (없을 때만) ── */
  try {
    const existing = rowsOf(await db.execute(sql`SELECT id, status, solapi_template_id AS tid FROM kakao_alimtalk_templates WHERE event_key = ${SPONSOR_WELCOME_EVENT_KEY} ORDER BY id DESC LIMIT 1`))[0];
    if (existing) {
      out.template = { id: Number(existing.id), status: existing.status, solapiTemplateId: existing.tid, created: false };
    } else {
      const ch = await solapiListChannels();
      if (!ch.ok) throw new Error(ch.error || "솔라피 카카오 채널 조회 실패");
      const list = (ch.data || []) as any[];
      const norm = (c: any) => ({ pfId: String(c?.channelId || c?.pfId || ""), name: String(c?.name || c?.searchId || "") });
      const envPf = process.env.SOLAPI_KAKAO_PFID || "";
      /* 교사유가족협의회 채널만 — 함께워크on 등 다른 채널 혼입 방지 */
      const picked = list.map(norm).find((c) => /교사유가족|협의회|tbfa/i.test(c.name))
        || (envPf ? list.map(norm).find((c) => c.pfId === envPf) : null)
        || (list.length ? norm(list[0]) : null);
      const pfId = picked?.pfId || "";
      if (!pfId) throw new Error("솔라피에 연동된 카카오 채널이 없습니다");

      const created = await solapiCreateTemplate({
        channelId: pfId,
        name: SPONSOR_WELCOME_TEMPLATE.name,
        content: SPONSOR_WELCOME_TEMPLATE.content,
        categoryCode: "004001",
        emphasizeType: "NONE",
        emphasizeSubtitle: "교사유가족협의회",
        buttons: SPONSOR_WELCOME_TEMPLATE.buttons,
      });
      if (!created.ok) throw new Error(created.error || "솔라피 템플릿 등록 실패");
      const tplId = String(created.data?.templateId || created.data?.id || "");
      if (!tplId) throw new Error("솔라피 응답에 템플릿 ID 없음: " + JSON.stringify(created.data).slice(0, 200));

      let status = "registered";
      let solapiStatus = String(created.data?.status || "PENDING");
      const insp = await solapiRequestInspection(tplId);
      if (insp.ok) { status = "inspecting"; solapiStatus = String(insp.data?.status || "INSPECTING"); }
      else out.warnings.push("검수 신청 실패(등록은 됨) — CMS 알림톡 템플릿에서 검수 요청: " + String(insp.error || "").slice(0, 200));

      const variables = ["이름", "캠페인"];
      const ins = rowsOf(await db.execute(sql`
        INSERT INTO kakao_alimtalk_templates
          (event_key, name, content, variables, category_code, emphasize_title, emphasize_subtitle,
           buttons, pf_id, solapi_template_id, status, solapi_status, inspection_requested_at, created_by, created_at, updated_at)
        VALUES (${SPONSOR_WELCOME_EVENT_KEY}, ${SPONSOR_WELCOME_TEMPLATE.name}, ${SPONSOR_WELCOME_TEMPLATE.content},
           ${JSON.stringify(variables)}::jsonb, '004001', NULL, '교사유가족협의회',
           ${JSON.stringify(SPONSOR_WELCOME_TEMPLATE.buttons)}::jsonb, ${pfId}, ${tplId},
           ${status}, ${solapiStatus}, ${insp.ok ? sql`NOW()` : null}, ${adminUid}, NOW(), NOW())
        RETURNING id`));
      out.template = { id: Number(ins[0]?.id || 0), status, solapiTemplateId: tplId, pfId, created: true };
    }
  } catch (e: any) {
    out.ok = false;
    out.template = { error: String(e?.message || e).slice(0, 400) };
  }

  /* ── ② 후속 여정 + 단계 시드 (없을 때만) ── */
  try {
    await db.execute(sql`
      INSERT INTO nurture_journeys (segment, name, is_active, entry_basis, created_at, updated_at)
      VALUES (${JOURNEY.segment}, ${JOURNEY.name}, false, ${JOURNEY.entryBasis}, NOW(), NOW())
      ON CONFLICT (segment) DO NOTHING`);
    const j = rowsOf(await db.execute(sql`SELECT id, is_active FROM nurture_journeys WHERE segment = ${JOURNEY.segment} LIMIT 1`))[0];
    const journeyId = Number(j?.id || 0);
    if (!journeyId) throw new Error("여정 행을 만들지 못했습니다");
    out.journey = { id: journeyId, isActive: !!j.is_active };

    const stepCount = Number(rowsOf(await db.execute(sql`SELECT COUNT(*)::int AS n FROM nurture_steps WHERE journey_id = ${journeyId}`))[0]?.n || 0);
    if (stepCount > 0) {
      out.steps = [{ skipped: true, existing: stepCount }];
    } else {
      let order = 0;
      for (const st of STEPS) {
        /* 본문 템플릿 — 같은 이름이 있으면 재사용 */
        let tplId = Number(rowsOf(await db.execute(sql`SELECT id FROM communication_templates WHERE name = ${st.tplName} LIMIT 1`))[0]?.id || 0);
        if (!tplId) {
          const t = rowsOf(await db.execute(sql`
            INSERT INTO communication_templates (name, channel, category, subject, body_template, variables, is_active, created_by, created_at, updated_at)
            VALUES (${st.tplName}, 'sms', 'nurture', NULL, ${st.body},
                    '[{"key":"이름","label":"회원이름","sample":"김후원"}]'::jsonb, true, ${adminUid}, NOW(), NOW())
            RETURNING id`));
          tplId = Number(t[0]?.id || 0);
        }
        const s = rowsOf(await db.execute(sql`
          INSERT INTO nurture_steps (journey_id, day_offset, channel, template_id, email_template_id, conditions, label, sort_order, is_active, created_at, updated_at)
          VALUES (${journeyId}, ${st.day}, 'sms', ${tplId || null}, NULL, '{}'::jsonb, ${st.label}, ${order++}, true, NOW(), NOW())
          RETURNING id`));
        out.steps.push({ id: Number(s[0]?.id || 0), day: st.day, templateId: tplId });
      }
    }
  } catch (e: any) {
    out.ok = false;
    out.journey = { error: String(e?.message || e).slice(0, 400) };
  }

  out.next = out.ok
    ? "완료 — ① 알림톡은 카카오 검수(1~3영업일) 뒤 자동 승인 반영, 그 전엔 문자. ② 후속 여정은 CMS 💌 후원자 너처링 › 예비 후원자 탭에서 문구 확인 후 ON. 이 파일은 삭제됩니다."
    : "일부 실패 — 위 error 확인 후 다시 호출(멱등)";
  return json(out, out.ok ? 200 : 500);
};
