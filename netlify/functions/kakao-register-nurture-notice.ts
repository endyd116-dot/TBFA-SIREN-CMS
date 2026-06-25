/**
 * kakao-register-nurture-notice — 1회용: 너처링 "소식 도착 알림" 알림톡을 솔라피 등록 + 카카오 검수요청.
 *
 * 카카오 알림톡은 정보성만 승인되므로, 마케팅 본문 대신 "협회가 소식을 보냈으니 확인해 주세요"
 * 정보성 1종을 등록한다(event_key='NURTURE_NOTICE'). 승인되면 너처링 엔진이 카톡 채널에 사용.
 *
 * GET                         → 진단(인증 불필요): 채널 연동·기존 등록 여부.
 * GET ?secret=...&run=1       → 시크릿 인증 후 등록 + 검수요청 (멱등: 이미 있으면 skip).
 *
 * 호출 성공·검수중 확인 후 이 파일 삭제(1회용 보안 원칙).
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import {
  solapiListChannels, solapiCreateTemplate, solapiRequestInspection,
} from "../../lib/solapi-client";

export const config = { path: "/api/kakao-register-nurture-notice" };
const H = { "Content-Type": "application/json; charset=utf-8" };

/* 정보성 "소식 도착 알림" 본문 — #{이름} 1변수. 풍부한 실제 내용은 문자·이메일·마이페이지 알림함으로
   전달, 알림톡은 도착 안내 + 버튼으로 알림함의 실제 소식을 연다(B안). */
const NOTICE_CONTENT =
`[교사유가족협의회]

#{이름}님, 안녕하세요.
교사유가족협의회입니다.

#{이름}님께 전해드리고 싶은 협의회 소식과 활동 이야기를
문자·이메일과 마이페이지 알림함으로 보내드렸습니다.

아래 버튼을 누르시면 받은 소식을 바로 확인하실 수 있습니다.
선생님들을 기억하고 유가족과 함께해 주셔서 깊이 감사드립니다.`;

const NOTICE_NAME = "너처링 소식 도착 알림";
const EVENT_KEY = "NURTURE_NOTICE";
const CATEGORY_CODE = "004001";
const EMPHASIZE_TITLE = "협의회 소식이 도착했어요";
const EMPHASIZE_SUBTITLE = "교사유가족협의회";
const BUTTONS = [
  { buttonType: "WL", buttonName: "소식 확인하기", linkMo: "https://tbfa.co.kr/mypage.html#notifications", linkPc: "https://tbfa.co.kr/mypage.html#notifications" },
];

function out(obj: object, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: H });
}

/* ★ 카카오 채널 2개 이상 연동(교사유가족협의회 + 함께워크on) → [0] 금지.
   교사유가족협의회 채널을 이름으로 선택, 못 찾으면 SOLAPI_KAKAO_PFID env, 최후로 첫 번째. */
function pickOrgChannel(list: any[]): { pfId: string; name: string } | null {
  if (!Array.isArray(list) || !list.length) return null;
  const norm = (c: any) => ({ pfId: String(c?.channelId || c?.pfId || ""), name: String(c?.name || c?.searchId || "") });
  const matched = list.map(norm).find((c) => /교사유가족|협의회|tbfa/i.test(c.name));
  if (matched && matched.pfId) return matched;
  const envPf = process.env.SOLAPI_KAKAO_PFID || "";
  if (envPf) { const byEnv = list.map(norm).find((c) => c.pfId === envPf); if (byEnv) return byEnv; }
  return norm(list[0]);
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";
  const secret = url.searchParams.get("secret") || "";

  /* 기존 등록 여부 */
  let existing: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, status, solapi_status AS "solapiStatus", solapi_template_id AS "tid"
        FROM kakao_alimtalk_templates WHERE event_key = ${EVENT_KEY} ORDER BY id DESC LIMIT 1`);
    existing = (r?.rows ?? r ?? [])[0] || null;
  } catch (e: any) {
    return out({ ok: false, step: "select_existing", detail: String(e?.message || e) }, 500);
  }

  /* ── 진단 모드 ── */
  if (!run) {
    let channels: any[] = [];
    let channelErr: string | null = null;
    try {
      const ch = await solapiListChannels();
      if (ch.ok) channels = (ch.data || []).map((c: any) => ({ pfId: c?.channelId || c?.pfId, name: c?.name || c?.searchId }));
      else channelErr = ch.error || "채널 조회 실패";
    } catch (e: any) { channelErr = String(e?.message || e); }
    return out({
      ok: true, mode: "diagnostic", eventKey: EVENT_KEY, existing,
      channelsConnected: channels.length, channels, channelErr,
      willUseChannel: pickOrgChannel(channels.length ? (channels as any[]) : []),
      noticeContent: NOTICE_CONTENT, buttons: BUTTONS,
      hint: "등록하려면 ?secret=<INTERNAL_TRIGGER_SECRET>&run=1",
    });
  }

  /* ── 실행 모드: 시크릿 인증 ── */
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (!expected || secret !== expected) return out({ ok: false, error: "시크릿 불일치" }, 403);

  /* 멱등: 이미 등록(검수중/승인 등)되어 있으면 재등록 안 함 */
  if (existing && existing.tid) {
    return out({ ok: true, skipped: true, reason: "이미 등록됨", existing });
  }

  try {
    /* 1) 카카오 채널(pfId) 조회 — 교사유가족협의회 채널 선택(함께워크on 등 타 채널 혼입 방지) */
    const ch = await solapiListChannels();
    if (!ch.ok) return out({ ok: false, step: "list_channels", detail: ch.error }, 502);
    const picked = pickOrgChannel(ch.data || []);
    const pfId = picked?.pfId || "";
    if (!pfId) return out({ ok: false, step: "no_channel", detail: "솔라피에 연동된 카카오 채널이 없습니다. 솔라피 콘솔에서 채널 연동 필요." }, 400);

    /* 2) 솔라피 템플릿 등록 */
    const created = await solapiCreateTemplate({
      channelId: pfId, name: NOTICE_NAME, content: NOTICE_CONTENT, categoryCode: CATEGORY_CODE,
      emphasizeType: "TEXT", emphasizeTitle: EMPHASIZE_TITLE, emphasizeSubtitle: EMPHASIZE_SUBTITLE, buttons: BUTTONS,
    });
    if (!created.ok) return out({ ok: false, step: "create_template", detail: created.error }, 502);
    const tplId = String(created.data?.templateId || created.data?.id || "");
    if (!tplId) return out({ ok: false, step: "create_no_id", detail: JSON.stringify(created.data).slice(0, 300) }, 502);

    /* 3) 검수 요청 */
    let status = "registered";
    let solapiStatus = String(created.data?.status || "PENDING");
    const insp = await solapiRequestInspection(tplId);
    if (insp.ok) { status = "inspecting"; solapiStatus = String(insp.data?.status || "INSPECTING"); }

    /* 4) DB insert (event_key=NURTURE_NOTICE → 엔진/어드민이 동일 출처로 사용) */
    const variables = ["이름"];
    const ins: any = await db.execute(sql`
      INSERT INTO kakao_alimtalk_templates
        (event_key, name, content, variables, category_code, emphasize_title, emphasize_subtitle,
         buttons, pf_id, solapi_template_id, status, solapi_status, inspection_requested_at, created_at, updated_at)
      VALUES (${EVENT_KEY}, ${NOTICE_NAME}, ${NOTICE_CONTENT}, ${JSON.stringify(variables)}::jsonb, ${CATEGORY_CODE},
         ${EMPHASIZE_TITLE}, ${EMPHASIZE_SUBTITLE}, ${JSON.stringify(BUTTONS)}::jsonb, ${pfId}, ${tplId},
         ${status}, ${solapiStatus}, ${insp.ok ? sql`NOW()` : null}, NOW(), NOW())
      RETURNING id`);
    const newId = Number((ins?.rows ?? ins ?? [])[0]?.id || 0);

    return out({ ok: true, registered: true, id: newId, solapiTemplateId: tplId, status, solapiStatus,
      note: "카카오 검수 진행 중(외부·1~2일). 승인되면 cron-kakao-template-status가 자동 'approved' 전환 → 엔진이 카톡 채널에 사용." });
  } catch (e: any) {
    return out({ ok: false, step: "register", detail: String(e?.message || e).slice(0, 500), stack: String(e?.stack || "").slice(0, 800) }, 500);
  }
};
