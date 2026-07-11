// lib/notify-payroll.ts
// 급여명세서 알림 — 인앱(종) + 카카오 알림톡(문자 폴백)
//
// 언제 나가나 (Swain 2026-07-12):
//   1) 명세서가 처음 도착했을 때 (관리자가 발송)
//   2) 수령 확인(전자서명)이 최종 완료됐을 때
//
// 발송 방식:
//   - 알림톡 템플릿이 승인돼 있으면 → 알림톡 (실패 시 솔라피가 같은 내용을 문자로 대체발송)
//   - 아직 템플릿이 승인 전이면 → **문자로 바로 발송** (알림이 아예 안 가는 일은 없게)
//   운영자가 통합 CMS '카카오 알림톡 템플릿'에서 아래 이벤트 키로 등록·검수하면
//   그때부터 자동으로 알림톡으로 전환된다.
//
// 안전 원칙: fire-and-forget — 어떤 실패도 급여 발송·서명 자체를 막지 않는다.

import { db } from "../db";
import { sql } from "drizzle-orm";

/** 통합 CMS 템플릿 등록 시 쓰는 이벤트 키 */
export const PAYROLL_KAKAO_EVENT_KEYS = {
  ISSUED: "payroll.issued",              // 급여명세서 도착 (수령확인 요청)
  ACKNOWLEDGED: "payroll.acknowledged",  // 수령확인(전자서명) 완료
} as const;

interface ApprovedTemplate { templateId: string; pfId: string; }

async function loadApprovedTemplate(eventKey: string): Promise<ApprovedTemplate | null> {
  try {
    const r: any = await db.execute(sql`
      SELECT solapi_template_id AS "tid", pf_id AS "pfId"
        FROM kakao_alimtalk_templates
       WHERE event_key = ${eventKey} AND status = 'approved' AND is_active = true
         AND solapi_template_id IS NOT NULL
       ORDER BY approved_at DESC NULLS LAST, id DESC
       LIMIT 1`);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row?.tid) return null;
    return { templateId: String(row.tid), pfId: String(row.pfId || "") };
  } catch { return null; }
}

/** 직원 1명의 전화번호 (숫자만). 없으면 null. */
async function loadMemberPhone(memberId: number): Promise<string | null> {
  try {
    const r: any = await db.execute(sql`
      SELECT phone FROM members WHERE id = ${memberId} AND status = 'active' LIMIT 1
    `);
    const raw = String((r?.rows ?? r ?? [])[0]?.phone || "").replace(/[^0-9]/g, "");
    return raw.length >= 10 ? raw : null;
  } catch { return null; }
}

/** "#{키}" 형태로 정규화 (솔라피 변수 규약) */
function toSolapiVars(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars || {})) {
    out[/^#\{.*\}$/.test(k) ? k : `#{${k}}`] = String(v ?? "");
  }
  return out;
}

/**
 * 직원 1명에게 급여 알림 발송 (알림톡 우선 · 없거나 실패하면 문자).
 * 절대 throw 하지 않는다.
 */
export async function sendPayrollNotice(opts: {
  eventKey: string;
  memberId: number;
  /** 알림톡 템플릿 변수 */
  vars: Record<string, string>;
  /** 알림톡 미승인·실패 시 나갈 문자 본문 (알림톡 내용과 같은 뜻이어야 함) */
  smsText: string;
}): Promise<{ channel: "alimtalk" | "sms" | "none"; ok: boolean }> {
  try {
    const phone = await loadMemberPhone(opts.memberId);
    if (!phone) return { channel: "none", ok: false };   // 번호 없음 — 인앱 알림으로만

    const tpl = await loadApprovedTemplate(opts.eventKey);
    const pfId = tpl?.pfId || process.env.SOLAPI_KAKAO_PFID || "";

    /* 1) 승인된 알림톡 템플릿이 있으면 알림톡 (실패 시 솔라피가 smsText로 대체발송) */
    if (tpl?.templateId && pfId) {
      const { solapiSendAlimtalk } = await import("./solapi-client");
      const res = await solapiSendAlimtalk({
        receiver: phone,
        pfId,
        templateId: tpl.templateId,
        variables: toSolapiVars(opts.vars),
        text: opts.smsText,     // 알림톡 실패 시 이 내용이 문자로 나간다
        disableSms: false,      // 문자 대체발송 허용 (Swain 요청)
      });
      if (res.ok) return { channel: "alimtalk", ok: true };
      console.warn(`[payroll-notice] 알림톡 실패 → 문자 재시도 event=${opts.eventKey}: ${res.error || res.message}`);
    }

    /* 2) 템플릿 미승인(또는 알림톡 실패) → 문자로 바로 발송 */
    const { solapiSendSms } = await import("./solapi-client");
    const sms = await solapiSendSms({ receiver: phone, msg: opts.smsText, title: "급여명세서" });
    if (!sms.ok) {
      console.warn(`[payroll-notice] 문자 발송 실패 event=${opts.eventKey}: ${sms.error || sms.message}`);
      return { channel: "sms", ok: false };
    }
    return { channel: "sms", ok: true };
  } catch (err: any) {
    console.warn(`[payroll-notice] 예외 event=${opts.eventKey}: ${String(err?.message ?? err).slice(0, 200)}`);
    return { channel: "none", ok: false };
  }
}

/** 명세서 도착 알림 — 관리자가 발송했을 때 */
export async function notifyPayrollIssued(opts: {
  memberId: number; memberName: string; year: number; month: number;
  netPay: number | string; orgName: string;
}) {
  const period = `${opts.year}년 ${String(opts.month).padStart(2, "0")}월`;
  const net = `${Math.round(Number(opts.netPay) || 0).toLocaleString("ko-KR")}원`;
  return sendPayrollNotice({
    eventKey: PAYROLL_KAKAO_EVENT_KEYS.ISSUED,
    memberId: opts.memberId,
    vars: { 이름: opts.memberName, 기간: period, 실수령액: net, 기관명: opts.orgName },
    smsText:
      `[${opts.orgName}] ${opts.memberName}님, ${period} 급여명세서가 도착했습니다.\n` +
      `실수령액 ${net}\n\n` +
      `내용을 확인하시고 수령 확인(전자서명)을 해주세요.\n` +
      `내용이 사실과 다르면 이의를 제기하실 수 있습니다.\n` +
      `${process.env.SITE_URL || "https://tbfa.co.kr"}/workspace-attendance.html`,
  });
}

/** 수령확인(전자서명) 완료 알림 — 직원 본인에게 보내는 확인 영수증 */
export async function notifyPayrollAcknowledged(opts: {
  memberId: number; memberName: string; year: number; month: number;
  signedAt: Date; orgName: string;
}) {
  const period = `${opts.year}년 ${String(opts.month).padStart(2, "0")}월`;
  const when = opts.signedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  return sendPayrollNotice({
    eventKey: PAYROLL_KAKAO_EVENT_KEYS.ACKNOWLEDGED,
    memberId: opts.memberId,
    vars: { 이름: opts.memberName, 기간: period, 서명일시: when, 기관명: opts.orgName },
    smsText:
      `[${opts.orgName}] ${opts.memberName}님, ${period} 급여명세서 수령 확인이 완료되었습니다.\n` +
      `서명일시 ${when}\n\n` +
      `서명본은 언제든 다시 확인·다운로드하실 수 있습니다.\n` +
      `${process.env.SITE_URL || "https://tbfa.co.kr"}/workspace-attendance.html`,
  });
}
