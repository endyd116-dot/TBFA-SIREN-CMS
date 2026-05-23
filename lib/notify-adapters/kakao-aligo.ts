// lib/notify-adapters/kakao-aligo.ts
// Phase 9 카카오 알림톡 어댑터 — 2026-05-23 알리고(프록시) → 솔라피(SOLAPI)로 발송 교체.
//
// 솔라피는 "templateId + 변수맵(#{한글변수})" 방식(알리고의 "렌더된 본문 + tplCode"와 다름).
// 등록 템플릿(카카오 승인본)은 솔라피 콘솔/문서(docs/active/2026-05-23-solapi-migration.md) 참조.
//
// 이벤트 → 솔라피 templateId(env):
//   BILLING_FAILED → SOLAPI_TPL_BILLING_FAILED  (정기 결제 실패)
//   CARD_EXPIRING  → SOLAPI_TPL_CARD_EXPIRING   (등록 카드 만료 안내)
//   ※ 출금완료/출금예정/영수증/후원변경 4종은 템플릿 등록 완료(승인 대기)이나 발송 트리거 설계 후 연결.
//
// Fallback(placeholder) 정책:
//   - templateId/pfId 미등록 · NOTIFICATION_TEST_MODE=true · 수신번호 없음 → 콘솔 로그만, status=sent
//   - 알림톡 실패 시 솔라피가 text를 SMS/LMS로 대체발송(disableSms:false)
//   - 운영자가 어드민에서 카카오 채널 끄면(loadEventTemplate skip) 발송 차단

import { db, members } from "../../db";
import { eq } from "drizzle-orm";
import { NotifyEvent } from "../notify-events";
import { solapiSendAlimtalk } from "../solapi-client";
import type { NotifyAdapter, AdapterSendOpts, AdapterResult } from "./types";
/* ★ 2026-05-16: 자동 발송 통합 CMS — 어드민 편집 본문 우선(대체발송 SMS 문구) + 채널 on/off skip 신호 */
import { loadEventTemplate } from "../notify-dispatcher";

/* 전화번호 정규화 (숫자만) — 알리고 의존 제거용 로컬 헬퍼 */
function normalizePhone(p: string | null | undefined): string {
  return String(p || "").replace(/[^0-9]/g, "");
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

/* enriched params 추출 — DB 템플릿 변수 치환과 폴백 본문 양쪽에 사용 (★ export — list API 미리보기) */
export function enrichKakaoParams(event: NotifyEvent, params: Record<string, any>, memberName: string): Record<string, any> {
  switch (event) {
    case NotifyEvent.BILLING_FAILED: {
      const name = String(params.memberName || memberName || "후원자");
      const amount = Number(params.amount) || 0;
      const failureReason = String(params.failureReason || "결제 실패");
      const failCount = Number(params.consecutiveFailCount) || 1;
      const willRetryAt = params.willRetryAt ? new Date(params.willRetryAt) : null;
      const retryStr = willRetryAt
        ? `${willRetryAt.getFullYear()}-${String(willRetryAt.getMonth() + 1).padStart(2, "0")}-${String(willRetryAt.getDate()).padStart(2, "0")}`
        : "추후 안내";
      return { name, amountFmt: amount.toLocaleString(), failureReason, failCount, retryStr };
    }
    case NotifyEvent.CARD_EXPIRING: {
      const name = String(params.memberName || memberName || "후원자");
      const cardExpiryMonth = String(params.cardExpiryMonth || "");
      const daysUntilExpiry = Number(params.daysUntilExpiry) || 0;
      let cardExpiryStr = cardExpiryMonth;
      if (/^\d{4}$/.test(cardExpiryMonth)) {
        cardExpiryStr = `20${cardExpiryMonth.slice(0, 2)}-${cardExpiryMonth.slice(2, 4)}`;
      }
      return { name, cardExpiryStr, daysUntilExpiry };
    }
    default:
      return {};
  }
}

/* 폴백 본문 (DB 템플릿 없을 때의 대체발송 SMS 문구) — enriched 변수 사용 (★ export — list API 미리보기) */
export function fallbackBodyKakao(event: NotifyEvent, e: Record<string, any>): string | null {
  switch (event) {
    case NotifyEvent.BILLING_FAILED:
      return `[교사유가족협의회] ${e.name}님, 이번 달 후원 결제 안내드려요

${e.name}님, 안녕하세요.
교사유가족협의회입니다.

이번 달 보내주시기로 한 정기 후원 ${e.amountFmt}원이
안타깝게도 결제되지 못했어요.

▪ 사유: ${e.failureReason}
▪ 연속 실패: ${e.failCount}회
▪ 다음 시도일: ${e.retryStr}

카드 한도와 잔액, 카드 정보를
한 번만 살펴봐 주시면 좋겠습니다.

${e.name}님의 따뜻한 마음이
유가족 곁에 끊김 없이 닿을 수 있도록
[후원 정보 확인] 버튼으로 잠시 점검해 주세요.

언제나 함께해 주셔서 진심으로 감사드립니다.`;

    case NotifyEvent.CARD_EXPIRING:
      return `[교사유가족협의회] ${e.name}님, 등록 카드 만료가 ${e.daysUntilExpiry}일 남았어요

${e.name}님, 안녕하세요.
교사유가족협의회입니다.

정기 후원에 등록해 주신 카드의
만료일이 가까워졌습니다.

▪ 카드 만료일: ${e.cardExpiryStr}
▪ 잔여 일수: ${e.daysUntilExpiry}일

만료 전에 새 카드 정보로 갱신해 주시면
${e.name}님께서 보내주시는 마음이
유가족 곁에 끊김 없이 계속 닿을 수 있어요.

[카드 정보 갱신] 버튼으로 잠깐만 시간 내 주세요.

오늘도 함께해 주셔서 진심으로 감사드립니다.`;

    default:
      return null;
  }
}

/* 이벤트 → 솔라피 templateId(env) */
function templateIdFor(event: NotifyEvent): string {
  switch (event) {
    case NotifyEvent.BILLING_FAILED: return process.env.SOLAPI_TPL_BILLING_FAILED || "";
    case NotifyEvent.CARD_EXPIRING:  return process.env.SOLAPI_TPL_CARD_EXPIRING || "";
    default: return "";
  }
}

/* 이벤트 → 솔라피 변수맵(#{한글변수}) — 등록 템플릿 변수명과 정확히 일치해야 함 */
function kakaoVariables(event: NotifyEvent, e: Record<string, any>): Record<string, string> {
  switch (event) {
    case NotifyEvent.BILLING_FAILED:
      return {
        "#{회원이름}": String(e.name ?? ""),
        "#{금액}": String(e.amountFmt ?? ""),
        "#{실패사유}": String(e.failureReason ?? ""),
        "#{연속실패횟수}": String(e.failCount ?? ""),
        "#{재시도일자}": String(e.retryStr ?? ""),
      };
    case NotifyEvent.CARD_EXPIRING:
      return {
        "#{회원이름}": String(e.name ?? ""),
        "#{카드만료일}": String(e.cardExpiryStr ?? ""),
        "#{잔여일수}": String(e.daysUntilExpiry ?? ""),
      };
    default:
      return {};
  }
}

interface BuildResult {
  templateId: string;
  variables: Record<string, string>;
  /* 알림톡 실패 시 솔라피 SMS 대체발송 문구 */
  smsText: string;
}

async function buildAlimtalk(
  event: NotifyEvent,
  params: Record<string, any>,
  memberName: string,
): Promise<BuildResult | { skip: true } | null> {
  /* 알림톡 정책 대상 이벤트만 (현재 2종 — 나머지 4종은 트리거 설계 후) */
  if (event !== NotifyEvent.BILLING_FAILED && event !== NotifyEvent.CARD_EXPIRING) {
    return null;
  }

  const enriched = enrichKakaoParams(event, params, memberName);

  /* 어드민 채널 on/off 신호 + 대체발송 SMS 본문(DB 우선) */
  const dbTpl = await loadEventTemplate({ event, channel: "kakao", params: enriched });
  if (dbTpl && "skip" in dbTpl) {
    return { skip: true };  /* isActive=false → 카카오 채널 끔 */
  }
  const dbBody = (dbTpl && !("skip" in dbTpl)) ? dbTpl.body : null;
  const smsText = dbBody || fallbackBodyKakao(event, enriched) || "";

  return {
    templateId: templateIdFor(event),
    variables: kakaoVariables(event, enriched),
    smsText,
  };
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

      const built = await buildAlimtalk(opts.event, opts.params, recipient.name);
      if (!built) {
        return { ok: true, providerMessageId: "skipped-no-template", latencyMs: Date.now() - t0 };
      }
      if ("skip" in built) {
        return { ok: true, providerMessageId: `skipped-admin-disabled-${opts.logId}`, latencyMs: Date.now() - t0 };
      }

      const pfId  = process.env.SOLAPI_KAKAO_PFID || "";
      const phone = normalizePhone(recipient.phone);

      /* Placeholder fallback: templateId/pfId 미등록 · 테스트 · 수신번호 없음 */
      const fallbackReasons: string[] = [];
      if (!built.templateId) fallbackReasons.push("템플릿ID 미등록");
      if (!pfId)             fallbackReasons.push("발신프로필키 미등록");
      if (testMode)          fallbackReasons.push("TEST_MODE");
      if (!phone)            fallbackReasons.push("수신번호 없음");

      if (fallbackReasons.length > 0) {
        console.log(
          `[kakao-solapi] PLACEHOLDER event=${opts.event} targetId=${opts.targetId}` +
          ` logId=${opts.logId} 사유=[${fallbackReasons.join(",")}]\n` +
          `--- 대체 SMS 본문 미리보기 ---\n${built.smsText}\n---`,
        );
        return { ok: true, providerMessageId: `kakao-placeholder-${opts.logId}`, latencyMs: Date.now() - t0 };
      }

      /* 실 발송 (솔라피 알림톡 + 실패 시 SMS 대체발송) */
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
