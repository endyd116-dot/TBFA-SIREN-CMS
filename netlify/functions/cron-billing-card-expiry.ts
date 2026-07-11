// netlify/functions/cron-billing-card-expiry.ts
// Phase 2 Step 4-C: 카드 만료 사전 알림 Scheduled Function
// - 매일 KST 오전 9시 (UTC 00:00) 실행
// - 30일 전 + 14일 전 만료 예정 카드 감지
// - card_expiry_alerts 중복 발송 방지
// - 이메일 + SMS + 알림톡 통보 (Phase 8 Stub)
//
// R40 KICC 제약(2026-05-23 운영 전 검수 P1-3): KICC 빌키발급 응답(cardInfo)에는
//    카드 "만료월"이 포함되지 않는다(빌키·발급사·마스킹번호·카드종류만 회신 — docs/kicc.md cardInfo).
//    따라서 KICC 빌키는 billing_keys.card_expiry_month가 NULL이라 본 cron의 사전 알림 대상에
//    "잡히지 않는다"(만료 데이터 자체가 없음 → 사전 알림 불가). 이는 코드 결함이 아니라 PG 제약.
//    대체 커버: 카드가 실제 만료되어 월 자동청구가 실패하면 cron-kicc-billing이 BILLING_FAILED
//    알림(인앱·이메일·SMS·알림톡)을 발송한다(사후·반응형). 사전 안내가 꼭 필요하면 KICC에 빌키
//    조회로 만료월을 받을 수 있는지 별도 확인 필요(현 명세엔 없음).

import type { Config } from "@netlify/functions";
import { db } from "../../db";
import {
  members,
  billingKeys,
  cardExpiryAlerts,
  type NewCardExpiryAlert,
} from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";
// Phase 8: 통합 알림 디스패처
import { dispatch } from "../../lib/notify-dispatcher";
import { NotifyEvent } from "../../lib/notify-events";

export const config: Config = {
  schedule: "0 0 * * *",  // UTC 00:00 = KST 09:00
};

/* =========================================================
   타입
   ========================================================= */

interface ExpiryTarget {
  memberId: number;
  memberName: string;
  memberEmail: string;
  memberPhone: string | null;
  billingKeyId: number;
  billingKey: string;
  cardCompany: string | null;
  cardNumberMasked: string | null;
  cardExpiryMonth: string;  // YYMM 또는 YYYY-MM
  alertType: "expiry_30d" | "expiry_14d" | "expired";
}

interface ExpirySummary {
  total30d: number;
  total14d: number;
  totalExpired: number;
  sentCount: number;
  skippedCount: number;
  errors: Array<{ memberId: number; error: string }>;
  startedAt: string;
  completedAt: string;
}

/* =========================================================
   메인 핸들러
   ========================================================= */

export default async (_req: Request) => {
  const startedAt = new Date();
  console.log(`[cron-card-expiry] 시작 ${startedAt.toISOString()}`);

  try {
    // 1. 30일 전 만료 예정 카드 조회
    const targets30d = await collectExpiryTargets(30);
    // 2. 14일 전 만료 예정 카드 조회
    const targets14d = await collectExpiryTargets(14);
    // 3. 이미 만료된 카드 조회
    const targetsExpired = await collectExpiredTargets();

    const allTargets = [...targets30d, ...targets14d, ...targetsExpired];

    console.log(`[cron-card-expiry] 대상: 30일전 ${targets30d.length}명, 14일전 ${targets14d.length}명, 만료됨 ${targetsExpired.length}명`);

    const summary: ExpirySummary = {
      total30d: targets30d.length,
      total14d: targets14d.length,
      totalExpired: targetsExpired.length,
      sentCount: 0,
      skippedCount: 0,
      errors: [],
      startedAt: startedAt.toISOString(),
      completedAt: "",
    };

    // 배치 처리 (10명씩)
    const BATCH_SIZE = 10;
    for (let i = 0; i < allTargets.length; i += BATCH_SIZE) {
      const batch = allTargets.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(target => processExpiryTarget(target, summary))
      );
    }

    summary.completedAt = new Date().toISOString();
    console.log(`[cron-card-expiry] 완료`, JSON.stringify(summary, null, 2));

    return new Response(
      JSON.stringify({ ok: true, summary }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error(`[cron-card-expiry] 치명적 오류:`, error);
    return new Response(
      JSON.stringify({ ok: false, error: error?.message }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

/* =========================================================
   1. N일 전 만료 예정 조회
   ========================================================= */

async function collectExpiryTargets(daysAhead: number): Promise<ExpiryTarget[]> {
  // 오늘로부터 daysAhead일 뒤의 YYMM 계산
  const target = new Date();
  target.setDate(target.getDate() + daysAhead);
  const yy = String(target.getFullYear()).slice(2);
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const targetYYMM = `${yy}${mm}`;           // 예: "2712"
  const targetYYYYMM = `${target.getFullYear()}-${mm}`;  // 예: "2027-12"

  const result: any = await db.execute(sql`
    SELECT
      m.id AS member_id,
      m.name AS member_name,
      m.email AS member_email,
      m.phone AS member_phone,
      bk.id AS billing_key_id,
      bk.billing_key,
      bk.card_company,
      bk.card_number_masked,
      bk.card_expiry_month
    FROM members m
    INNER JOIN billing_keys bk ON bk.member_id = m.id
    WHERE bk.is_active = true
      AND m.withdrawn_at IS NULL
      AND m.status = 'active'
      AND (
        bk.card_expiry_month = ${targetYYMM}
        OR bk.card_expiry_month = ${targetYYYYMM}
      )
  `);

  const rows = Array.isArray(result) ? result : (result as any).rows || [];
  const alertType = daysAhead === 30 ? "expiry_30d" : "expiry_14d";

  return rows.map((r: any) => ({
    memberId: r.member_id,
    memberName: r.member_name,
    memberEmail: r.member_email,
    memberPhone: r.member_phone,
    billingKeyId: r.billing_key_id,
    billingKey: r.billing_key,
    cardCompany: r.card_company,
    cardNumberMasked: r.card_number_masked,
    cardExpiryMonth: r.card_expiry_month,
    alertType: alertType as "expiry_30d" | "expiry_14d",
  }));
}

/* =========================================================
   2. 이미 만료된 카드 조회
   ========================================================= */

async function collectExpiredTargets(): Promise<ExpiryTarget[]> {
  // 현재 월 기준으로 이전 월 카드 검출
  const now = new Date();
  const currentYY = String(now.getFullYear()).slice(2);
  const currentMM = String(now.getMonth() + 1).padStart(2, "0");
  const currentYYMM = `${currentYY}${currentMM}`;

  const result: any = await db.execute(sql`
    SELECT
      m.id AS member_id,
      m.name AS member_name,
      m.email AS member_email,
      m.phone AS member_phone,
      bk.id AS billing_key_id,
      bk.billing_key,
      bk.card_company,
      bk.card_number_masked,
      bk.card_expiry_month
    FROM members m
    INNER JOIN billing_keys bk ON bk.member_id = m.id
    WHERE bk.is_active = true
      AND m.withdrawn_at IS NULL
      AND m.status = 'active'
      AND bk.card_expiry_month IS NOT NULL
      AND LENGTH(bk.card_expiry_month) = 4
      AND bk.card_expiry_month < ${currentYYMM}
  `);

  const rows = Array.isArray(result) ? result : (result as any).rows || [];
  return rows.map((r: any) => ({
    memberId: r.member_id,
    memberName: r.member_name,
    memberEmail: r.member_email,
    memberPhone: r.member_phone,
    billingKeyId: r.billing_key_id,
    billingKey: r.billing_key,
    cardCompany: r.card_company,
    cardNumberMasked: r.card_number_masked,
    cardExpiryMonth: r.card_expiry_month,
    alertType: "expired" as const,
  }));
}

/* =========================================================
   3. 개별 처리
   ========================================================= */

async function processExpiryTarget(
  target: ExpiryTarget,
  summary: ExpirySummary
): Promise<void> {
  try {
    // 중복 발송 체크 (uq_card_expiry_alert)
    const existing: any = await db.execute(sql`
      SELECT id FROM card_expiry_alerts
      WHERE member_id = ${target.memberId}
        AND alert_type = ${target.alertType}
        AND card_expiry_month = ${target.cardExpiryMonth}
      LIMIT 1
    `);
    const existingRows = Array.isArray(existing) ? existing : (existing as any).rows || [];

    if (existingRows.length > 0) {
      summary.skippedCount++;
      return;
    }

    // 알림 발송 (Phase 8 — 통합 디스패처)
    // 채널 정책 자체는 EVENT_CHANNEL_POLICY[CARD_EXPIRING] = inapp + email + kakao
    // (kakao는 Phase 8 단계 placeholder, Phase 9에서 실 발송 교체)
    const daysUntilExpiry =
      target.alertType === "expiry_30d" ? 30
      : target.alertType === "expiry_14d" ? 14
      : 0;
    const subjectLabel =
      target.alertType === "expired"     ? "결제 카드 만료 — 갱신 필요"
      : target.alertType === "expiry_14d" ? "결제 카드 만료 14일 전 — 갱신 안내"
                                          : "결제 카드 만료 30일 전 — 갱신 안내";
    const bodyText =
      target.alertType === "expired"
        ? "등록하신 결제 카드가 만료되어 정기 결제가 중단될 수 있습니다. 마이페이지에서 카드를 갱신해주세요."
        : `등록하신 결제 카드가 ${daysUntilExpiry}일 후 만료됩니다. 정기 후원이 끊기지 않도록 마이페이지에서 카드를 미리 갱신해주세요.`;

    dispatch({
      event: NotifyEvent.CARD_EXPIRING,
      target: { type: "member", id: target.memberId },
      params: {
        memberName:       target.memberName,
        cardCompany:      target.cardCompany,
        cardNumberMasked: target.cardNumberMasked,
        cardExpiryMonth:  target.cardExpiryMonth,
        daysUntilExpiry,
        alertType:        target.alertType,
        title:            subjectLabel,
        message:          bodyText,
        emailBody:        bodyText,
        link:             "/mypage.html",
        category:         "billing",
        severity:         target.alertType === "expired" ? "warning" : "info",
        refTable:         "billing_keys",
        refId:            target.billingKeyId,
      },
    });

    const channels: string[] = ["inapp"];
    if (target.memberEmail) channels.push("email");
    channels.push("kakao");

    console.log(`[cron-card-expiry] 알림: 회원 #${target.memberId} (${target.memberName}) — ${target.alertType} (${target.cardExpiryMonth})`);

    // 이력 기록
    await db.insert(cardExpiryAlerts).values({
      memberId: target.memberId,
      billingKey: target.billingKey,
      cardExpiryMonth: target.cardExpiryMonth,
      alertType: target.alertType,
      channelsSent: channels.join(","),
    } as any);

    summary.sentCount++;
  } catch (error: any) {
    console.error(`[cron-card-expiry] 회원 #${target.memberId} 처리 실패:`, error);
    summary.errors.push({
      memberId: target.memberId,
      error: error?.message || String(error),
    });
  }
}
