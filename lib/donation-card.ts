// lib/donation-card.ts — «카드 결제 받기» 전역 스위치 (2026-11-12 Swain)
//
// 왜: 지금 카드 결제(KICC 이지페이 — 카드·간편결제·실시간 계좌이체)는 다른 사업자(비영리법인 118) 명의로 정산된다.
//     사단법인 회비가 다른 명의로 들어가지 않도록, KG이니시스 카드 결제가 열릴 때까지 카드 결제를 닫아 둔다.
//     남는 결제 수단: 특별회원(월 정기회비) = 효성 CMS+ 계좌 자동이체 · 일반회원(연회비) = 직접 계좌이체(입금 확인).
// 저장: site_settings scope 'donation' · key 'cardEnabled' · value_text 'true'/'false'.
//       행이 없거나 읽기에 실패하면 «꺼짐»(안전한 쪽). 마이그 없음 — 어드민 › 시스템 설정 › 후원 정책 관리 › 「카드 결제」에서 켜고 끈다.
//       (같은 방식의 선례: lib/donation-membership.ts «회원 가입 필수»)
// 효과(꺼짐일 때):
//   ① 결제 창(donate.js) — 특별회원은 효성 CMS, 일반회원은 직접 계좌이체만 보인다(카드 선택지 숨김·자동 선택)
//   ② 새 카드 결제 요청을 서버가 거절한다(400 · step 'card_disabled') — 화면을 우회해도 막힘
//      일시 카드(donate-kicc-register) · 정기 카드 등록(billing-register) ·
//      AM 결제 의도(lantern-payment-intent 의 card/easy/transfer — 포트원 단계 포함) · 미리 채운 결제 페이지(lantern-pay-start)
//   이미 등록된 정기 카드의 자동 청구(cron-kicc-billing)·카드 변경·해지·결제사 복귀(approve) 처리는 이 스위치와 무관하다.
import { sql } from "drizzle-orm";
import { db } from "../db";

const SCOPE = "donation";
const KEY = "cardEnabled";
const TTL_MS = 60 * 1000;
let cache: { value: boolean; at: number } | null = null;

export const DEFAULT_CARD_ENABLED = false;
export const CARD_DISABLED_STEP = "card_disabled";
export const CARD_DISABLED_MESSAGE =
  "지금은 카드 결제를 받지 않습니다. 계좌 자동이체(효성 CMS) 또는 계좌이체를 이용해 주세요.";

/** 현재 스위치 값 — 인스턴스별 60초 캐시(설정 저장 직후 같은 인스턴스는 즉시 갱신). 행이 없거나 읽기 실패면 꺼짐 */
export async function isCardPaymentEnabled(): Promise<boolean> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let value = DEFAULT_CARD_ENABLED;
  try {
    const r: any = await db.execute(sql`SELECT value_text FROM site_settings WHERE scope = ${SCOPE} AND key = ${KEY} LIMIT 1`);
    const row = (r?.rows ?? r ?? [])[0];
    if (row && row.value_text != null) {
      value = String(row.value_text).trim().toLowerCase() === "true";
    }
  } catch (e: any) {
    console.warn("[donation-card] 설정 조회 실패(꺼짐으로 처리):", e?.message || e);
    value = false;
  }
  cache = { value, at: Date.now() };
  return value;
}

/** 스위치 저장 — 발행값으로 바로(임시저장 단계 없음). 행이 없으면 만든다 */
export async function setCardPaymentEnabled(value: boolean, adminId: number | null): Promise<void> {
  const text = value ? "true" : "false";
  const r: any = await db.execute(sql`SELECT id FROM site_settings WHERE scope = ${SCOPE} AND key = ${KEY} LIMIT 1`);
  const row = (r?.rows ?? r ?? [])[0];
  if (row) {
    await db.execute(sql`
      UPDATE site_settings
         SET value_text = ${text}, draft_value_text = NULL, has_draft = false, updated_at = NOW(), updated_by = ${adminId}
       WHERE id = ${row.id}`);
  } else {
    await db.execute(sql`
      INSERT INTO site_settings (scope, key, value_type, value_text, description, sort_order, is_active, updated_at, updated_by)
      VALUES (${SCOPE}, ${KEY}, 'text', ${text}, ${"카드 결제 받기(KICC 카드·간편결제·실시간 계좌이체) — 후원 정책 화면에서 관리"}, 0, true, NOW(), ${adminId})`);
  }
  cache = { value, at: Date.now() };
}

/** 카드 결제 거절 응답 — 400 { ok:false, error, step:'card_disabled' } (lib/response 와 같은 머리글) */
export function cardDisabledResponse(): Response {
  return new Response(
    JSON.stringify({ ok: false, error: CARD_DISABLED_MESSAGE, step: CARD_DISABLED_STEP }),
    {
      status: 400,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    },
  );
}
