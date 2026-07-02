// lib/notify-operator-kakao.ts
// 운영자 대상 카카오 알림톡 발송 헬퍼 (2026-07-01)
//
// 목적: 후원·SIREN 신고·유족지원·가입 등 운영자 주요 이벤트를 인앱 알림에 더해
//   카카오 알림톡으로도 알린다. 단, **카카오 검수 승인이 완료된 템플릿이 없으면
//   절대 발송하지 않고 조용히 통과(no-op)** 한다.
//
// 안전 원칙(전부 fire-and-forget):
//   - kakao_alimtalk_templates에서 eventKey로 조회 → status='approved' + solapi_template_id
//     존재일 때만 발송. 없으면 즉시 return(no-op).
//   - 대상: type='admin' AND operator_active=TRUE AND status='active' AND phone IS NOT NULL
//           (전화번호 등록된 활성 운영자 전원). 운영자 업무 알림은 '정보성'이라
//           마케팅 수신동의 불요 — 후원자용 kakao_marketing_consent_at 게이트를 걸면
//           직원은 사실상 아무도 못 받아 원래 요구('모든 운영자')와 어긋남(2026-07-02 fix).
//   - 발송 실패는 로그만. 절대 throw 하지 않음(호출부 기존 로직 보호).
//   - 발송 대상 0명·미승인·테이블 미생성 → 조용히 종료.
//
// 활성화 흐름: 운영자가 통합 CMS(카카오 알림톡 템플릿 관리)에서 아래 eventKey로
//   템플릿을 등록 → 검수 요청 → 카카오 승인 → status='approved' 되면 자동으로 발송 시작.
//   승인 전까지 이 헬퍼는 완전한 no-op이라 운영에 무해하다.

import { db } from "../db";
import { sql } from "drizzle-orm";

/** 운영자 알림톡 이벤트 키 카탈로그 (CMS 등록 시 이 키로 매핑) */
export const OPERATOR_KAKAO_EVENT_KEYS = {
  DONATION: "operator.donation",          // 새 후원(정기·일시) 접수
  SIREN_REPORT: "operator.siren_report",  // SIREN 신고(사건·괴롭힘·법률) 접수
  SUPPORT_SIGNUP: "operator.support_signup", // 유족지원 신청·신규 가입
} as const;

interface ApprovedTemplate {
  templateId: string;
  pfId: string;
}

/** eventKey → 승인·활성 알림톡 템플릿(solapi templateId + pfId) 조회. 없으면 null. */
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
    if (!row || !row.tid) return null;
    return { templateId: String(row.tid), pfId: String(row.pfId || "") };
  } catch {
    return null;
  }
}

/** 수신동의·번호검증된 활성 운영자의 전화번호 목록 조회. */
async function loadOperatorPhones(): Promise<string[]> {
  try {
    /* 정보성 운영자 알림 — 전화번호 등록된 활성 운영자 전원(마케팅 동의 불요) */
    const r: any = await db.execute(sql`
      SELECT phone
        FROM members
       WHERE type = 'admin'
         AND operator_active = TRUE
         AND status = 'active'
         AND phone IS NOT NULL`);
    const rows = (r?.rows ?? r ?? []) as any[];
    const seen = new Set<string>();
    for (const row of rows) {
      const p = String(row?.phone || "").replace(/[^0-9]/g, "");
      if (p.length >= 10) seen.add(p);
    }
    return [...seen];
  } catch {
    return [];
  }
}

/** eventKey를 "#{한글변수}" 형태 솔라피 변수맵으로 정규화 (양쪽 키 형태 모두 수용). */
function toSolapiVars(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars || {})) {
    const key = /^#\{.*\}$/.test(k) ? k : `#{${k}}`;
    out[key] = String(v ?? "");
  }
  return out;
}

/**
 * 운영자에게 카카오 알림톡 발송 (승인 전엔 조용히 no-op).
 * fire-and-forget — 절대 throw 하지 않는다.
 */
export async function sendOperatorAlimtalk(
  eventKey: string,
  vars: Record<string, string>,
): Promise<void> {
  try {
    /* 1) 승인·활성 템플릿 없으면 즉시 종료(no-op) */
    const tpl = await loadApprovedTemplate(eventKey);
    if (!tpl || !tpl.templateId) return;

    const pfId = tpl.pfId || process.env.SOLAPI_KAKAO_PFID || "";
    if (!pfId) return; // 발신프로필 없으면 조용히 종료

    /* 2) 수신 대상(수신동의·번호검증 운영자) 없으면 종료 */
    const phones = await loadOperatorPhones();
    if (phones.length === 0) return;

    /* 3) 각 운영자에게 발송 — 기존 솔라피 알림톡 클라이언트 재사용. 실패는 로그만. */
    const { solapiSendAlimtalk } = await import("./solapi-client");
    const variables = toSolapiVars(vars);
    for (const phone of phones) {
      try {
        const res = await solapiSendAlimtalk({
          receiver: phone,
          pfId,
          templateId: tpl.templateId,
          variables,
          disableSms: true, // 운영자 알림톡 실패 시 SMS 대체발송은 하지 않음(비용·인앱 알림으로 이미 커버)
        });
        if (!res.ok) {
          console.warn(`[operator-kakao] 발송 실패 event=${eventKey} to=${phone}: ${res.error || res.message || "?"}`);
        }
      } catch (err: any) {
        console.warn(`[operator-kakao] 발송 예외 event=${eventKey} to=${phone}: ${String(err?.message || err).slice(0, 200)}`);
      }
    }
  } catch (err: any) {
    /* 어떤 예외도 호출부로 전파하지 않음 */
    console.warn(`[operator-kakao] no-op/예외 event=${eventKey}: ${String(err?.message || err).slice(0, 200)}`);
  }
}
