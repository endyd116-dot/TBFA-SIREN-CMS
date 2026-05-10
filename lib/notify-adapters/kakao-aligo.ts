// lib/notify-adapters/kakao-aligo.ts
// Phase 9 — Aligo 카카오 알림톡 어댑터 (kakao-placeholder.ts 대체)
//
// 이벤트별 템플릿 매핑:
//   BILLING_FAILED → ALIGO_TEMPLATE_BILLING_FAILED
//   CARD_EXPIRING  → ALIGO_TEMPLATE_CARD_EXPIRING
//
// 변수 치환은 카카오 심사 통과한 템플릿 본문과 정확히 일치해야 발송됨.
// (설계서 §8 — 협의회 따뜻한 톤 템플릿)
//
// Fallback 정책 (placeholder 동작):
//   - 템플릿 ID 환경변수 미등록 → 콘솔 로그만, status=sent 기록
//   - NOTIFICATION_TEST_MODE=true → 동일하게 콘솔 로그만
//   - 카카오 심사 통과 전에도 전체 알림 흐름 회귀 검증 가능

import { db, members } from "../../db";
import { eq } from "drizzle-orm";
import { NotifyEvent } from "../notify-events";
import {
  sendAligoAlimtalk,
  normalizePhone,
} from "../aligo-kakao-client";
import type { NotifyAdapter, AdapterSendOpts, AdapterResult } from "./types";

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

/* ─── 이벤트 → 템플릿 ID + 본문 빌더 ─── */
interface BuildResult {
  tplCode: string | null;
  message: string;
  subject: string;
  buttonJson: string;
}

function buildAlimtalk(
  event: NotifyEvent,
  params: Record<string, any>,
  memberName: string,
): BuildResult | null {
  const linkUrl = "https://tbfa-siren-cms.netlify.app/mypage/donation";

  switch (event) {
    case NotifyEvent.BILLING_FAILED: {
      const tplCode = process.env.ALIGO_TEMPLATE_BILLING_FAILED || "";
      const name = String(params.memberName || memberName || "후원자");
      const amount = Number(params.amount) || 0;
      const failureReason = String(params.failureReason || "결제 실패");
      const failCount = Number(params.consecutiveFailCount) || 1;
      const willRetryAt = params.willRetryAt ? new Date(params.willRetryAt) : null;
      const retryStr = willRetryAt
        ? `${willRetryAt.getFullYear()}-${String(willRetryAt.getMonth() + 1).padStart(2, "0")}-${String(willRetryAt.getDate()).padStart(2, "0")}`
        : "추후 안내";

      // 설계서 §8 템플릿 1 — 변수: 회원이름·금액·실패사유·연속실패횟수·재시도일자
      const message =
`[교사유가족협의회] ${name}님, 이번 달 후원 결제 안내드려요

${name}님, 안녕하세요.
교사유가족협의회입니다.

이번 달 보내주시기로 한 정기 후원 ${amount.toLocaleString()}원이
안타깝게도 결제되지 못했어요.

▪ 사유: ${failureReason}
▪ 연속 실패: ${failCount}회
▪ 다음 시도일: ${retryStr}

카드 한도와 잔액, 카드 정보를
한 번만 살펴봐 주시면 좋겠습니다.

${name}님의 따뜻한 마음이
유가족 곁에 끊김 없이 닿을 수 있도록
[후원 정보 확인] 버튼으로 잠시 점검해 주세요.

언제나 함께해 주셔서 진심으로 감사드립니다.`;

      const buttonJson = JSON.stringify({
        button: [{
          name: "후원 정보 확인",
          linkType: "WL",
          linkTypeName: "웹링크",
          linkM: linkUrl,
          linkP: linkUrl,
        }],
      });

      return { tplCode: tplCode || null, message, subject: "", buttonJson };
    }

    case NotifyEvent.CARD_EXPIRING: {
      const tplCode = process.env.ALIGO_TEMPLATE_CARD_EXPIRING || "";
      const name = String(params.memberName || memberName || "후원자");
      const cardExpiryMonth = String(params.cardExpiryMonth || "");
      const daysUntilExpiry = Number(params.daysUntilExpiry) || 0;

      // 카드 만료일 표기 정규화 (YYMM/YYYY-MM → YYYY-MM)
      let cardExpiryStr = cardExpiryMonth;
      if (/^\d{4}$/.test(cardExpiryMonth)) {
        const yy = cardExpiryMonth.slice(0, 2);
        const mm = cardExpiryMonth.slice(2, 4);
        cardExpiryStr = `20${yy}-${mm}`;
      }

      // 설계서 §8 템플릿 2 — 변수: 회원이름·카드만료일·잔여일수
      const message =
`[교사유가족협의회] ${name}님, 등록 카드 만료가 ${daysUntilExpiry}일 남았어요

${name}님, 안녕하세요.
교사유가족협의회입니다.

정기 후원에 등록해 주신 카드의
만료일이 가까워졌습니다.

▪ 카드 만료일: ${cardExpiryStr}
▪ 잔여 일수: ${daysUntilExpiry}일

만료 전에 새 카드 정보로 갱신해 주시면
${name}님께서 보내주시는 마음이
유가족 곁에 끊김 없이 계속 닿을 수 있어요.

[카드 정보 갱신] 버튼으로 잠깐만 시간 내 주세요.

오늘도 함께해 주셔서 진심으로 감사드립니다.`;

      const buttonJson = JSON.stringify({
        button: [{
          name: "카드 정보 갱신",
          linkType: "WL",
          linkTypeName: "웹링크",
          linkM: linkUrl,
          linkP: linkUrl,
        }],
      });

      return { tplCode: tplCode || null, message, subject: "", buttonJson };
    }

    default:
      // 알림톡 정책 미대상 이벤트 — skip
      return null;
  }
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
        return {
          ok: false,
          error: `수신자 조회 실패 (targetId=${opts.targetId})`,
          latencyMs: Date.now() - t0,
        };
      }

      const built = buildAlimtalk(opts.event, opts.params, recipient.name);
      if (!built) {
        // 알림톡 미대상 이벤트 — 실패 아닌 스킵
        return {
          ok: true,
          providerMessageId: "skipped-no-template",
          latencyMs: Date.now() - t0,
        };
      }

      const senderKey = process.env.ALIGO_KAKAO_CHANNEL_ID || "";
      const sender    = process.env.ALIGO_SENDER || "";
      const phone     = normalizePhone(recipient.phone);

      // ── Placeholder fallback 조건 ──
      // (1) 템플릿 ID 미등록  (2) 카카오 채널 키 미등록  (3) 테스트 모드  (4) 수신자 번호 없음
      const fallbackReasons: string[] = [];
      if (!built.tplCode)  fallbackReasons.push("템플릿ID 미등록");
      if (!senderKey)      fallbackReasons.push("카카오채널키 미등록");
      if (testMode)        fallbackReasons.push("TEST_MODE");
      if (!phone)          fallbackReasons.push("수신번호 없음");

      if (fallbackReasons.length > 0) {
        console.log(
          `[kakao-aligo] PLACEHOLDER event=${opts.event} targetId=${opts.targetId}` +
          ` logId=${opts.logId} 사유=[${fallbackReasons.join(",")}]\n` +
          `--- 본문 미리보기 ---\n${built.message}\n---`,
        );
        return {
          ok: true,
          providerMessageId: `kakao-placeholder-${opts.logId}`,
          latencyMs: Date.now() - t0,
        };
      }

      // ── 실 발송 ──
      const result = await sendAligoAlimtalk({
        tplCode:    built.tplCode!,
        receiver:   phone,
        message:    built.message,
        subject:    built.subject,
        buttonJson: built.buttonJson,
        senderKey,
        sender,
      });

      if (!result.ok) {
        return {
          ok: false,
          error: result.error || `Aligo 발송 실패 (code=${result.code})`,
          latencyMs: Date.now() - t0,
        };
      }

      return {
        ok: true,
        providerMessageId: result.providerMessageId,
        latencyMs: Date.now() - t0,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: String(err?.message || err).slice(0, 500),
        latencyMs: Date.now() - t0,
      };
    }
  },
};
