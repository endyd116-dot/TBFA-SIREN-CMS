// lib/sponsor-welcome-notice.ts
// ★ 2026-09-06 후원회원 가입 직후 «등록 안내» 카톡/문자 1통 (Swain 지시 — A안·가입자 전원·초안 그대로)
//
// 누구에게: 「등불의 기적」 랜딩(숭고한 등불) 모달·SIREN 후원 창에서 새로 후원회원이 된 사람(createSponsorMember).
// 무엇을:  ① 후원회원으로 등록된 사실 ② 홈페이지에서 같은 휴대폰 번호로 인증하면 회원가입이 바로 완료된다
//          ③ 협의회 소식·분기 «등불 보고»를 받아볼 수 있다 — 가입 사실 통지(정보성)라 소식 수신 동의와 무관하게 보낸다.
// 어떻게:  카카오 알림톡 템플릿(event_key SPONSOR_WELCOME)이 승인돼 있으면 알림톡(+실패 시 솔라피 SMS 대체발송),
//          아직 검수 중이면 같은 내용을 문자(LMS)로. 어느 쪽이든 마이페이지 알림함(인앱)에도 기록을 남긴다.
// 제외:    자가 점검이 만드는 시험 회원(이메일 @lantern.invalid)·휴대폰 없음.
//
// 템플릿 등록·검수 신청은 1회용 migrate-sponsor-welcome(어드민 ?run=1)이 한다. 본문을 바꾸면 새 템플릿 검수가 필요하다.

import { sql } from "drizzle-orm";
import { db } from "../db";
import { solapiSendAlimtalk, solapiSendSms } from "./solapi-client";
import { createNotification } from "./notify";

const SITE_URL = (process.env.SITE_URL || "https://tbfa.co.kr").replace(/\/+$/, "");

export const SPONSOR_WELCOME_EVENT_KEY = "SPONSOR_WELCOME";
/** 문자·알림톡 버튼이 여는 주소 — 홈 화면이 가입 창(휴대폰 인증)을 바로 연다(public/index.html) */
export const SPONSOR_WELCOME_JOIN_URL = `${SITE_URL}/?signup=1`;

/** 카카오 검수용 알림톡 템플릿(정보성) — #{이름}·#{캠페인} 변수. 바꾸면 새 템플릿 등록·검수 필요 */
export const SPONSOR_WELCOME_TEMPLATE = {
  name: "후원회원 등록 안내(등불의 기적)",
  content:
    "[교사유가족협의회] #{이름}님, 후원회원 등록을 안내드려요\n\n" +
    "「#{캠페인}」을 통해 사단법인 교사유가족협의회 후원회원으로 등록되셨습니다.\n\n" +
    "▪ 홈페이지(tbfa.co.kr)에서 같은 휴대폰 번호로 인증하시면 회원가입이 바로 완료되고, 마이페이지에서 후원 내역·등불 증서·정기 후원 해지를 직접 관리하실 수 있어요.\n" +
    "▪ 협의회 소식과 분기 «등불 보고»도 받아보실 수 있습니다.\n\n" +
    "※ 저희는 사단법인으로, 아직 기부금영수증(세액공제) 발급이 되지 않습니다.",
  buttons: [
    { buttonType: "WL", buttonName: "홈페이지에서 가입 완료하기", linkMo: SPONSOR_WELCOME_JOIN_URL, linkPc: SPONSOR_WELCOME_JOIN_URL },
  ],
};

/** 문자(LMS)·알림톡 대체발송 본문 — 템플릿과 같은 글자 + 링크 한 줄 */
export function renderSponsorWelcomeText(name: string, campaignTitle: string): string {
  return SPONSOR_WELCOME_TEMPLATE.content
    .split("#{이름}").join(name)
    .split("#{캠페인}").join(campaignTitle)
    + `\n\n▶ 가입 완료하기: ${SPONSOR_WELCOME_JOIN_URL}`;
}

/** 승인된 알림톡 템플릿 — 없으면 null(→ 문자) */
async function loadApprovedTemplate(): Promise<{ templateId: string; pfId: string } | null> {
  try {
    const r: any = await db.execute(sql`
      SELECT solapi_template_id AS tid, pf_id AS pfid
        FROM kakao_alimtalk_templates
       WHERE event_key = ${SPONSOR_WELCOME_EVENT_KEY} AND status = 'approved' AND is_active = true
         AND solapi_template_id IS NOT NULL
       ORDER BY approved_at DESC NULLS LAST, id DESC
       LIMIT 1`);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row || !row.tid) return null;
    const pfId = String(row.pfid || process.env.SOLAPI_KAKAO_PFID || "");
    if (!pfId) return null;
    return { templateId: String(row.tid), pfId };
  } catch {
    return null;
  }
}

export interface SponsorWelcomeInput {
  memberId: number;
  name: string;
  phone: string | null | undefined;
  email?: string | null;
  campaignTitle: string;
}

export interface SponsorWelcomeResult {
  ok: boolean;
  via: "alimtalk" | "sms" | "skipped";
  error?: string;
}

/** 가입 직후 1통 — 실패해도 throw 하지 않는다(가입 트랜잭션과 무관) */
export async function sendSponsorWelcomeNotice(input: SponsorWelcomeInput): Promise<SponsorWelcomeResult> {
  try {
    if (String(input.email || "").toLowerCase().endsWith("@lantern.invalid")) return { ok: true, via: "skipped" };
    const phone = String(input.phone || "").replace(/[^0-9]/g, "");
    if (phone.length < 10) return { ok: false, via: "skipped", error: "휴대폰 없음" };

    const name = String(input.name || "후원자").trim().slice(0, 40) || "후원자";
    const campaign = String(input.campaignTitle || "등불의 기적").trim().slice(0, 60);
    const text = renderSponsorWelcomeText(name, campaign);

    let via: SponsorWelcomeResult["via"] = "sms";
    let res: { ok: boolean; error?: string };
    const tpl = await loadApprovedTemplate();
    if (tpl) {
      via = "alimtalk";
      res = await solapiSendAlimtalk({
        receiver: phone,
        pfId: tpl.pfId,
        templateId: tpl.templateId,
        variables: { "#{이름}": name, "#{캠페인}": campaign },
        disableSms: false,
        text,
      });
    } else {
      res = await solapiSendSms({ receiver: phone, msg: text, title: "후원회원 등록 안내" });
    }

    /* 마이페이지 알림함에도 남긴다 — 문자는 흘러가도 계정 안에는 남게 */
    try {
      await createNotification({
        recipientId: input.memberId,
        recipientType: "user",
        category: "donation",
        severity: "info",
        title: "후원회원 등록 안내",
        message: text.slice(0, 480),
        link: "/mypage.html#donations",
      });
    } catch (e: any) {
      console.warn("[sponsor-welcome] 인앱 기록 실패:", e?.message || e);
    }

    if (!res.ok) console.warn(`[sponsor-welcome] ${via} 발송 실패 member=${input.memberId}: ${res.error}`);
    else console.log(`[sponsor-welcome] ${via} 발송 member=${input.memberId}`);
    return { ok: res.ok, via, error: res.error };
  } catch (e: any) {
    console.warn("[sponsor-welcome] 발송 오류:", e?.message || e);
    return { ok: false, via: "skipped", error: String(e?.message || e).slice(0, 200) };
  }
}
