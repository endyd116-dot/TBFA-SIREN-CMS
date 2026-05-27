// lib/notify-adapters/kakao-aligo.ts
// Phase 9 카카오 알림톡 어댑터 — 2026-05-23 알리고(프록시) → 솔라피(SOLAPI)로 발송 교체.
//
// 솔라피는 "templateId + 변수맵(#{한글변수})" 방식. 등록 템플릿(카카오 승인본)은
// docs/active/2026-05-23-solapi-migration.md 참조.
//
// 이벤트 → 솔라피 templateId(env):
//   BILLING_FAILED          → SOLAPI_TPL_BILLING_FAILED   (정기 결제 실패)
//   CARD_EXPIRING           → SOLAPI_TPL_CARD_EXPIRING    (등록 카드 만료 안내)
//   BILLING_SUCCESS         → SOLAPI_TPL_BILLING_SUCCESS  (정기 후원금 출금 완료 안내)
//   BILLING_UPCOMING        → SOLAPI_TPL_BILLING_UPCOMING (정기 후원금 자동 출금 예정 안내)
//   DONATION_RECEIPT_ANNUAL → SOLAPI_TPL_RECEIPT          (연간 기부금 영수증 발급 안내)
//   DONOR_INFO_CHANGED      → SOLAPI_TPL_DONOR_CHANGE     (후원 정보 변경 처리 완료)
//
// Fallback: templateId/pfId 미등록·TEST_MODE·수신번호 없음 → placeholder(로그만).
// 알림톡 실패 시 솔라피가 text를 SMS/LMS로 대체발송(disableSms:false).
// 운영자가 어드민에서 카카오 채널 끄면(loadEventTemplate skip) 발송 차단.

import { db, members } from "../../db";
import { eq, sql } from "drizzle-orm";
import { NotifyEvent } from "../notify-events";
import { solapiSendAlimtalk } from "../solapi-client";
import type { NotifyAdapter, AdapterSendOpts, AdapterResult } from "./types";
import { loadEventTemplate } from "../notify-dispatcher";

/** 알림톡 대상 이벤트(솔라피 등록 6종) */
const SUPPORTED = new Set<NotifyEvent>([
  NotifyEvent.BILLING_FAILED,
  NotifyEvent.CARD_EXPIRING,
  NotifyEvent.BILLING_SUCCESS,
  NotifyEvent.BILLING_UPCOMING,
  NotifyEvent.DONATION_RECEIPT_ANNUAL,
  NotifyEvent.DONOR_INFO_CHANGED,
]);

function normalizePhone(p: string | null | undefined): string {
  return String(p || "").replace(/[^0-9]/g, "");
}

function fmtYmd(v: any): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ─── 수신자 정보 조회 ─── */
async function lookupRecipient(targetId: number): Promise<{ name: string; phone: string } | null> {
  try {
    const [row] = await db
      .select({ name: members.name, phone: members.phone })
      .from(members)
      .where(eq(members.id, targetId))
      .limit(1);
    if (!row) return null;
    return { name: (row as any).name || "", phone: (row as any).phone || "" };
  } catch {
    return null;
  }
}

/* enriched params 추출 — DB 템플릿 변수 치환·폴백·솔라피 변수맵에 사용 (★ export — list API 미리보기) */
export function enrichKakaoParams(event: NotifyEvent, params: Record<string, any>, memberName: string): Record<string, any> {
  const name = String(params.memberName || memberName || "후원자");
  switch (event) {
    case NotifyEvent.BILLING_FAILED: {
      const amount = Number(params.amount) || 0;
      const willRetryAt = params.willRetryAt ? new Date(params.willRetryAt) : null;
      return {
        name,
        amountFmt: amount.toLocaleString(),
        failureReason: String(params.failureReason || "결제 실패"),
        failCount: Number(params.consecutiveFailCount) || 1,
        retryStr: willRetryAt ? fmtYmd(willRetryAt) : "추후 안내",
      };
    }
    case NotifyEvent.CARD_EXPIRING: {
      const cardExpiryMonth = String(params.cardExpiryMonth || "");
      let cardExpiryStr = cardExpiryMonth;
      if (/^\d{4}$/.test(cardExpiryMonth)) cardExpiryStr = `20${cardExpiryMonth.slice(0, 2)}-${cardExpiryMonth.slice(2, 4)}`;
      return { name, cardExpiryStr, daysUntilExpiry: Number(params.daysUntilExpiry) || 0 };
    }
    case NotifyEvent.BILLING_SUCCESS: {
      const amount = Number(params.amount) || 0;
      return {
        name,
        amountFmt: amount.toLocaleString(),
        chargedStr: fmtYmd(params.chargedAt || new Date()),
        cumulativeFmt: "",  /* buildAlimtalk에서 DB 조회로 채움 */
      };
    }
    case NotifyEvent.BILLING_UPCOMING: {
      const amount = Number(params.amount) || 0;
      return {
        name,
        amountFmt: amount.toLocaleString(),
        chargeDateStr: fmtYmd(params.chargeDate),
        paymentMethod: String(params.paymentMethod || "등록 카드"),
      };
    }
    case NotifyEvent.DONATION_RECEIPT_ANNUAL: {
      const annual = Number(params.annualAmount) || 0;
      return {
        name,
        year: String(params.year || new Date().getFullYear() - 1),
        annualFmt: annual.toLocaleString(),
        issuePeriod: String(params.issuePeriod || "연중"),
        receiptType: String(params.receiptType || "기부금 영수증"),
      };
    }
    case NotifyEvent.DONOR_INFO_CHANGED: {
      return {
        name,
        changeField: String(params.changeField || "후원 정보"),
        changeValue: String(params.changeValue || ""),
        changedAtStr: fmtYmd(params.changedAt || new Date()),
      };
    }
    default:
      return { name };
  }
}

/* 이벤트 → 솔라피 templateId(env·폴백용) */
function templateIdFor(event: NotifyEvent): string {
  switch (event) {
    case NotifyEvent.BILLING_FAILED:          return process.env.SOLAPI_TPL_BILLING_FAILED || "";
    case NotifyEvent.CARD_EXPIRING:           return process.env.SOLAPI_TPL_CARD_EXPIRING || "";
    case NotifyEvent.BILLING_SUCCESS:         return process.env.SOLAPI_TPL_BILLING_SUCCESS || "";
    case NotifyEvent.BILLING_UPCOMING:        return process.env.SOLAPI_TPL_BILLING_UPCOMING || "";
    case NotifyEvent.DONATION_RECEIPT_ANNUAL: return process.env.SOLAPI_TPL_RECEIPT || "";
    case NotifyEvent.DONOR_INFO_CHANGED:      return process.env.SOLAPI_TPL_DONOR_CHANGE || "";
    default: return "";
  }
}

/* 이벤트 → DB에 등록된 "승인" 알림톡 템플릿(solapi templateId + pfId) 조회.
   운영자가 CMS에서 관리하는 kakao_alimtalk_templates가 단일 출처. 테이블 미생성(마이그 전)·
   미승인이면 null → 호출부가 env 폴백 또는 placeholder 처리. */
async function loadApprovedKakaoTemplate(event: NotifyEvent): Promise<{ templateId: string; pfId: string } | null> {
  try {
    const r: any = await db.execute(sql`
      SELECT solapi_template_id AS "tid", pf_id AS "pfId"
        FROM kakao_alimtalk_templates
       WHERE event_key = ${String(event)} AND status = 'approved' AND is_active = true
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

/* 이벤트 → 솔라피 변수맵(#{한글변수}) — 등록 템플릿 변수명과 정확히 일치해야 함 */
function kakaoVariables(event: NotifyEvent, e: Record<string, any>): Record<string, string> {
  const S = (v: any) => String(v ?? "");
  switch (event) {
    case NotifyEvent.BILLING_FAILED:
      return { "#{회원이름}": S(e.name), "#{금액}": S(e.amountFmt), "#{실패사유}": S(e.failureReason), "#{연속실패횟수}": S(e.failCount), "#{재시도일자}": S(e.retryStr) };
    case NotifyEvent.CARD_EXPIRING:
      return { "#{회원이름}": S(e.name), "#{카드만료일}": S(e.cardExpiryStr), "#{잔여일수}": S(e.daysUntilExpiry) };
    case NotifyEvent.BILLING_SUCCESS:
      return { "#{회원이름}": S(e.name), "#{출금금액}": S(e.amountFmt), "#{출금일시}": S(e.chargedStr), "#{누적후원금액}": S(e.cumulativeFmt) };
    case NotifyEvent.BILLING_UPCOMING:
      return { "#{회원이름}": S(e.name), "#{출금금액}": S(e.amountFmt), "#{출금예정일}": S(e.chargeDateStr), "#{결제수단}": S(e.paymentMethod) };
    case NotifyEvent.DONATION_RECEIPT_ANNUAL:
      return { "#{회원이름}": S(e.name), "#{연도}": S(e.year), "#{연간후원금액}": S(e.annualFmt), "#{발급가능기간}": S(e.issuePeriod), "#{영수증종류}": S(e.receiptType) };
    case NotifyEvent.DONOR_INFO_CHANGED:
      return { "#{회원이름}": S(e.name), "#{변경항목}": S(e.changeField), "#{변경후내용}": S(e.changeValue), "#{처리일시}": S(e.changedAtStr) };
    default:
      return {};
  }
}

/* 폴백 본문(알림톡 실패 시 SMS 대체발송 문구) — 등록 템플릿과 동일 문안 (★ export — list API 미리보기) */
export function fallbackBodyKakao(event: NotifyEvent, e: Record<string, any>): string | null {
  switch (event) {
    case NotifyEvent.BILLING_FAILED:
      return `[교사유가족협의회] ${e.name}님, 이번 달 후원 결제 안내드려요\n\n${e.name}님, 안녕하세요.\n교사유가족협의회입니다.\n\n이번 달 보내주시기로 한 정기 후원 ${e.amountFmt}원이\n안타깝게도 결제되지 못했어요.\n\n▪ 사유: ${e.failureReason}\n▪ 연속 실패: ${e.failCount}회\n▪ 다음 시도일: ${e.retryStr}\n\n카드 한도와 잔액, 카드 정보를 한 번만 살펴봐 주시면 좋겠습니다.\n\n언제나 함께해 주셔서 진심으로 감사드립니다.`;
    case NotifyEvent.CARD_EXPIRING:
      return `[교사유가족협의회] ${e.name}님, 등록 카드 만료가 ${e.daysUntilExpiry}일 남았어요\n\n정기 후원에 등록해 주신 카드의 만료일이 가까워졌습니다.\n\n▪ 카드 만료일: ${e.cardExpiryStr}\n▪ 잔여 일수: ${e.daysUntilExpiry}일\n\n만료 전에 새 카드 정보로 갱신해 주시면 마음이 끊김 없이 계속 닿을 수 있어요.\n\n오늘도 함께해 주셔서 진심으로 감사드립니다.`;
    case NotifyEvent.BILLING_SUCCESS:
      return `[교사유가족협의회] ${e.name}님, 후원 출금이 무사히 완료되었어요\n\n이번 달 정기 후원 ${e.amountFmt}원이 무사히 출금되었습니다.\n\n- 출금 일시: ${e.chargedStr}\n- 누적 후원: ${e.cumulativeFmt}원\n\n기부금 영수증은 마이페이지에서 확인하실 수 있어요.\n언제나 함께해 주셔서 진심으로 감사드립니다.`;
    case NotifyEvent.BILLING_UPCOMING:
      return `[교사유가족협의회] ${e.name}님, 이번 달 후원 출금을 안내드려요\n\n이번 달 정기 후원 ${e.amountFmt}원이 다음과 같이 자동 출금될 예정이에요.\n\n- 출금 예정일: ${e.chargeDateStr}\n- 결제 수단: ${e.paymentMethod}\n\n언제나 함께해 주셔서 진심으로 감사드려요.`;
    case NotifyEvent.DONATION_RECEIPT_ANNUAL:
      return `[교사유가족협의회] ${e.name}님, 기부금 영수증 발급을 안내드려요\n\n${e.year}년도 한 해 동안 보내주신 마음을 정리해 안내드려요.\n\n- 연간 후원 총액: ${e.annualFmt}원\n- 발급 가능 기간: ${e.issuePeriod}\n- 영수증 종류: ${e.receiptType}\n\n기부금 영수증은 마이페이지에서 발급받으실 수 있어요.\n언제나 함께해 주셔서 진심으로 감사드립니다.`;
    case NotifyEvent.DONOR_INFO_CHANGED:
      return `[교사유가족협의회] ${e.name}님, 후원 정보 변경이 완료되었어요\n\n요청하신 후원 정보 변경이 처리 완료되었습니다.\n- 변경 항목: ${e.changeField}\n- 변경 후 내용: ${e.changeValue}\n- 처리 일시: ${e.changedAtStr}\n\n변경된 내용은 마이페이지에서 확인하실 수 있어요.\n${e.name}님과 함께 걷는 이 길에 깊이 감사드립니다.`;
    default:
      return null;
  }
}

interface BuildResult {
  templateId: string;
  pfId: string;
  variables: Record<string, string>;
  smsText: string;
}

async function buildAlimtalk(
  event: NotifyEvent,
  params: Record<string, any>,
  memberName: string,
  targetId: number,
): Promise<BuildResult | { skip: true } | null> {
  if (!SUPPORTED.has(event)) return null;

  const enriched = enrichKakaoParams(event, params, memberName);

  /* 출금완료: 누적 후원금액 DB 조회 */
  if (event === NotifyEvent.BILLING_SUCCESS) {
    try {
      const r: any = await db.execute(sql`
        SELECT COALESCE(SUM(amount), 0)::bigint AS total
          FROM donations WHERE member_id = ${targetId} AND status = 'completed'`);
      const total = Number((r?.rows ?? r ?? [])[0]?.total) || 0;
      enriched.cumulativeFmt = total.toLocaleString();
    } catch {
      enriched.cumulativeFmt = enriched.amountFmt;
    }
  }

  /* 어드민 채널 on/off 신호 + 대체발송 SMS 본문(DB 우선) */
  const dbTpl = await loadEventTemplate({ event, channel: "kakao", params: enriched });
  if (dbTpl && "skip" in dbTpl) return { skip: true };
  const dbBody = (dbTpl && !("skip" in dbTpl)) ? dbTpl.body : null;
  const smsText = dbBody || fallbackBodyKakao(event, enriched) || "";

  /* 발송 템플릿ID·발신프로필 = DB(운영자 관리) 우선, 없으면 env 폴백 */
  const tpl = await loadApprovedKakaoTemplate(event);
  const templateId = tpl?.templateId || templateIdFor(event);
  const pfId = tpl?.pfId || process.env.SOLAPI_KAKAO_PFID || "";

  return { templateId, pfId, variables: kakaoVariables(event, enriched), smsText };
}

/* ─── 어댑터 ─── */
export const kakaoAligoAdapter: NotifyAdapter = {
  channel: "kakao",

  async send(opts: AdapterSendOpts): Promise<AdapterResult> {
    const t0 = Date.now();
    const testMode = String(process.env.NOTIFICATION_TEST_MODE || "").toLowerCase() === "true";

    try {
      const recipient = await lookupRecipient(opts.targetId);
      if (!recipient) {
        return { ok: false, error: `수신자 조회 실패 (targetId=${opts.targetId})`, latencyMs: Date.now() - t0 };
      }

      const built = await buildAlimtalk(opts.event, opts.params, recipient.name, opts.targetId);
      if (!built) {
        return { ok: true, providerMessageId: "skipped-no-template", latencyMs: Date.now() - t0 };
      }
      if ("skip" in built) {
        return { ok: true, providerMessageId: `skipped-admin-disabled-${opts.logId}`, latencyMs: Date.now() - t0 };
      }

      const pfId  = built.pfId || process.env.SOLAPI_KAKAO_PFID || "";
      const phone = normalizePhone(recipient.phone);

      const fallbackReasons: string[] = [];
      if (!built.templateId) fallbackReasons.push("템플릿ID 미등록(CMS 알림톡 템플릿 승인 필요)");
      if (!pfId)             fallbackReasons.push("발신프로필키 미등록");
      if (testMode)          fallbackReasons.push("TEST_MODE");
      if (!phone)            fallbackReasons.push("수신번호 없음");

      if (fallbackReasons.length > 0) {
        console.log(
          `[kakao-solapi] PLACEHOLDER event=${opts.event} targetId=${opts.targetId}` +
          ` logId=${opts.logId} 사유=[${fallbackReasons.join(",")}]`,
        );
        return { ok: true, providerMessageId: `kakao-placeholder-${opts.logId}`, latencyMs: Date.now() - t0 };
      }

      const result = await solapiSendAlimtalk({
        receiver: phone,
        pfId,
        templateId: built.templateId,
        variables: built.variables,
        disableSms: false,
        text: built.smsText,
      });

      if (!result.ok) {
        return { ok: false, error: result.error || `솔라피 알림톡 발송 실패 (status=${result.statusCode})`, latencyMs: Date.now() - t0 };
      }
      return { ok: true, providerMessageId: result.msgId, latencyMs: Date.now() - t0 };
    } catch (err: any) {
      return { ok: false, error: String(err?.message || err).slice(0, 500), latencyMs: Date.now() - t0 };
    }
  },
};
