// lib/kakao-nurture-notice.ts
// 2026-06-26 카카오 알림톡 "우회" 발송 — 후원자 너처링 1차 채널=kakao 전용.
//
// 배경: 카카오 알림톡은 "정보성"만 승인되고 광고성(마케팅 본문)은 거절 → 임의 너처링 본문을
//   알림톡으로 직접 보낼 수 없다. 우회: 협회가 등록·검수한 "소식 도착 알림"(정보성 1종)을
//   알림톡으로 보내 브랜드 터치를 남기고(버튼→마이페이지), 실제 풍부한 본문은
//   ① 보조 메일(있으면) ② SMS 대체발송(text 폴백)으로 전달한다.
//
// 안전 강등: 승인된 NURTURE_NOTICE 템플릿이 아직 없으면(검수 전·반려) 자동으로 "일반 문자"로
//   실제 본문을 보낸다 → 카톡 단계라도 내용 미수신 없음(검수와 무관하게 즉시 작동).
//
// 호출: nurture-engine.sendMulti() 가 1차 채널이 kakao일 때 executeTrigger 대신 이 함수 사용.
//   (알림톡은 "등록 템플릿ID+변수"만 지원 → 대량발송 디스패처 경로가 정책상 스킵하므로 직접 발송.)

import { db } from "../db";
import { sql } from "drizzle-orm";
import { solapiSendAlimtalk, solapiSendSms } from "./solapi-client";
import { renderTemplate } from "./template-render";
import { buildMemberRenderData } from "./communication-send";
import { unsubUrl } from "./unsubscribe-token";

const BASE_URL = process.env.SITE_URL || "https://tbfa.co.kr";

/** 너처링 "소식 도착 알림" 승인 템플릿(event_key='NURTURE_NOTICE') 로드 — 없으면 null(→문자 강등). */
export async function loadNurtureNotice(): Promise<{ templateId: string; pfId: string } | null> {
  try {
    const r: any = await db.execute(sql`
      SELECT solapi_template_id AS "tid", pf_id AS "pfId"
        FROM kakao_alimtalk_templates
       WHERE event_key = 'NURTURE_NOTICE' AND status = 'approved' AND is_active = true
         AND solapi_template_id IS NOT NULL
       ORDER BY approved_at DESC NULLS LAST, id DESC
       LIMIT 1`);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row || !row.tid) return null;
    return { templateId: String(row.tid), pfId: String(row.pfId || process.env.SOLAPI_KAKAO_PFID || "") };
  } catch {
    return null;
  }
}

interface NurtureKakaoResult { ok: boolean; sent: number; viaAlimtalk: boolean }

/**
 * 카카오 1차 채널 너처링 발송.
 * @param due       발송 대상 행 [{ member_id, ... }] (도달성·빈도 필터는 엔진에서 이미 통과)
 * @param primaryTpl 실제 본문 템플릿 id (communication_templates) — 알림톡 SMS 대체발송 본문 + 문자 강등 본문
 * @param journeyName 라벨(로그용)
 */
export async function sendNurtureKakao(due: any[], primaryTpl: number, _journeyName: string): Promise<NurtureKakaoResult> {
  const memberIds = due.map((d) => Number(d.member_id)).filter(Boolean);
  if (!memberIds.length || !primaryTpl) return { ok: false, sent: 0, viaAlimtalk: false };

  /* 실제 본문 템플릿 */
  const tplRes: any = await db.execute(sql`
    SELECT body_template, variables FROM communication_templates WHERE id = ${primaryTpl} AND is_active = true LIMIT 1`);
  const tpl = (tplRes?.rows ?? tplRes ?? [])[0];
  if (!tpl) return { ok: false, sent: 0, viaAlimtalk: false };
  const variables: any[] = Array.isArray(tpl.variables) ? tpl.variables : [];

  /* 회원 이름·전화 */
  const mRes: any = await db.execute(sql`SELECT id, name, email, phone FROM members WHERE id = ANY(${sql.raw(`ARRAY[${memberIds.map(Number).filter(Number.isFinite).join(",") || "0"}]::int[]`)})`);
  const mMap = new Map<number, any>();
  for (const m of (mRes?.rows ?? mRes ?? [])) mMap.set(Number(m.id), m);

  const notice = await loadNurtureNotice();      // 승인된 알림톡 있으면 알림톡, 없으면 문자 강등
  const viaAlimtalk = !!(notice && notice.templateId && notice.pfId);

  let sent = 0;
  for (const mid of memberIds) {
    const member = mMap.get(mid);
    const phone = String(member?.phone || "").replace(/[^0-9]/g, "");
    if (!member || phone.length < 10) continue;

    const data = buildMemberRenderData({ id: member.id, name: member.name, email: member.email, phone: member.phone });
    let realText = renderTemplate(String(tpl.body_template || ""), variables, data).rendered;
    /* 마케팅 발송 — 수신거부 링크(문자/카톡 채널) 자동 삽입(재동의 가능) */
    realText += `\n\n[무료수신거부] ${unsubUrl(BASE_URL, mid, "sms")}`;
    const name = String(member.name || "후원자").slice(0, 40);

    try {
      let res;
      if (viaAlimtalk) {
        /* 알림톡 "소식 도착 알림"(정보성) + 실패/비친구 시 text(실제 본문)로 SMS 대체발송 */
        res = await solapiSendAlimtalk({
          receiver: phone, pfId: notice!.pfId, templateId: notice!.templateId,
          variables: { "#{이름}": name }, disableSms: false, text: realText,
        });
      } else {
        /* 검수 전·미승인 — 일반 문자로 실제 본문 전달(강등) */
        res = await solapiSendSms({ receiver: phone, msg: realText, title: "교사유가족협의회 소식" });
      }
      if (res.ok) sent++;
    } catch (e: any) {
      console.warn(`[nurture-kakao] 발송 실패 mid=${mid}: ${e?.message || e}`);
    }
  }
  return { ok: sent > 0, sent, viaAlimtalk };
}
