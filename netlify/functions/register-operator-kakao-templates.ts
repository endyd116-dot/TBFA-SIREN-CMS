/**
 * GET /api/register-operator-kakao-templates        — 진단(등록 상태)
 * GET /api/register-operator-kakao-templates?run=1   — 실행(super_admin): 솔라피 등록 + 검수요청
 *
 * 운영자용 카카오 알림톡 3종을 솔라피에 등록하고 검수를 요청한다.
 * (admin-kakao-templates POST와 동일한 흐름: 채널조회→템플릿생성→검수요청→DB insert)
 * event_key로 저장하므로 승인되면 lib/notify-operator-kakao 헬퍼가 자동 발송.
 *
 * 멱등: 같은 event_key 활성 템플릿이 이미 있으면 스킵. 호출 후 이 파일 삭제.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { solapiListChannels, solapiCreateTemplate, solapiRequestInspection } from "../../lib/solapi-client";

export const config = { path: "/api/register-operator-kakao-templates" };
const JH = { "Content-Type": "application/json; charset=utf-8" };

const TEMPLATES = [
  {
    eventKey: "operator.donation",
    name: "운영자-새후원접수",
    content:
      "[교사유가족협의회] 새 후원 접수 알림\n\n#{이름}님의 후원 #{금액}원이 접수되었습니다.\n\n운영자 페이지에서 상세 내용을 확인해 주세요.",
  },
  {
    eventKey: "operator.siren_report",
    name: "운영자-신고접수",
    content:
      "[교사유가족협의회] SIREN 신고 접수 알림\n\n새로운 #{유형}이(가) 접수되었습니다.\n제목: #{제목}\n\n운영자 페이지에서 확인·배정해 주세요.",
  },
  {
    eventKey: "operator.support_signup",
    name: "운영자-지원가입접수",
    content:
      "[교사유가족협의회] 신규 접수 알림\n\n#{이름}님의 #{구분} 접수가 확인되었습니다.\n\n운영자 페이지에서 확인해 주세요.",
  },
];

const BUTTONS = [{ buttonType: "WL", buttonName: "교사유가족협의회 홈이동", linkMo: "https://tbfa.co.kr/", linkPc: "https://tbfa.co.kr/" }];
const CATEGORY_CODE = "004001";

function vars(content: string): string[] {
  const set = new Set<string>(); const re = /#\{([^}]+)\}/g; let m;
  while ((m = re.exec(content))) set.add(m[1].trim());
  return [...set];
}
async function rows(q: any): Promise<any[]> { const r: any = await q; return r?.rows ?? r ?? []; }

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const existing = await rows(db.execute(sql`
      SELECT event_key, name, status, solapi_template_id AS tid FROM kakao_alimtalk_templates
       WHERE event_key IN ('operator.donation','operator.siren_report','operator.support_signup')`));

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnose",
        alreadyRegistered: existing,
        willRegister: TEMPLATES.filter(t => !existing.some((e: any) => e.event_key === t.eventKey)).map(t => t.eventKey),
        hint: "?run=1 로 실행(super_admin) → 솔라피 등록 + 검수요청.",
      }, null, 2), { headers: JH });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;
    if (auth.ctx.member.role !== "super_admin") {
      return new Response(JSON.stringify({ ok: false, error: "super_admin 권한이 필요합니다" }), { status: 403, headers: JH });
    }
    const adminId = auth.ctx.admin.uid;

    step = "channel";
    const ch = await solapiListChannels();
    if (!ch.ok) return new Response(JSON.stringify({ ok: false, error: "솔라피 채널 조회 실패", detail: ch.error }), { status: 502, headers: JH });
    const norm = (c: any) => ({ pfId: String(c?.channelId || c?.pfId || ""), name: String(c?.name || c?.searchId || "") });
    const list = (ch.data || []).map(norm);
    const envPf = process.env.SOLAPI_KAKAO_PFID || "";
    const picked = list.find((c: any) => /교사유가족|협의회|tbfa/i.test(c.name))
      || (envPf ? list.find((c: any) => c.pfId === envPf) : null)
      || (list.length ? list[0] : null);
    const pfId = picked?.pfId || "";
    if (!pfId) return new Response(JSON.stringify({ ok: false, error: "연동된 카카오 채널이 없습니다. 솔라피 콘솔에서 채널을 먼저 연동하세요." }), { status: 400, headers: JH });

    const results: any[] = [];
    for (const t of TEMPLATES) {
      if (existing.some((e: any) => e.event_key === t.eventKey)) { results.push({ eventKey: t.eventKey, skipped: "이미 등록됨" }); continue; }
      try {
        step = `create:${t.eventKey}`;
        const created = await solapiCreateTemplate({
          channelId: pfId, name: t.name, content: t.content, categoryCode: CATEGORY_CODE,
          emphasizeType: "NONE", emphasizeTitle: "", emphasizeSubtitle: "교사유가족협의회", buttons: BUTTONS,
        });
        if (!created.ok) { results.push({ eventKey: t.eventKey, error: "등록 실패", detail: created.error }); continue; }
        const tplId = String(created.data?.templateId || created.data?.id || "");
        if (!tplId) { results.push({ eventKey: t.eventKey, error: "templateId 없음" }); continue; }

        step = `inspect:${t.eventKey}`;
        let status = "registered"; let solapiStatus = String(created.data?.status || "PENDING");
        const insp = await solapiRequestInspection(tplId);
        if (insp.ok) { status = "inspecting"; solapiStatus = String(insp.data?.status || "INSPECTING"); }

        step = `insert:${t.eventKey}`;
        await db.execute(sql`
          INSERT INTO kakao_alimtalk_templates
            (event_key, name, content, variables, category_code, emphasize_title, emphasize_subtitle,
             buttons, pf_id, solapi_template_id, status, solapi_status, inspection_requested_at, created_by, created_at, updated_at)
          VALUES (${t.eventKey}, ${t.name}, ${t.content}, ${JSON.stringify(vars(t.content))}::jsonb, ${CATEGORY_CODE},
             ${null}, ${"교사유가족협의회"}, ${JSON.stringify(BUTTONS)}::jsonb, ${pfId}, ${tplId},
             ${status}, ${solapiStatus}, ${insp.ok ? sql`NOW()` : null}, ${adminId}, NOW(), NOW())`);
        results.push({ eventKey: t.eventKey, solapiTemplateId: tplId, status, inspectionRequested: insp.ok });
      } catch (e: any) {
        results.push({ eventKey: t.eventKey, error: String(e?.message || e).slice(0, 300) });
      }
    }

    step = "done";
    return new Response(JSON.stringify({
      ok: true, mode: "executed", pfId, results,
      hint: "검수 요청 완료. 카카오 승인(1~3영업일) 후 자동 발송 시작. 상태는 통합 CMS '카카오 알림톡 템플릿' 또는 cron이 자동 갱신. 확인 후 이 파일 삭제.",
    }, null, 2), { headers: JH });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "운영자 알림톡 등록 실패", step,
      detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JH });
  }
}
