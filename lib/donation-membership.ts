// lib/donation-membership.ts — «후원회원 가입 필수» 전역 스위치 (2026-10-31 Swain A안)
//
// 저장: site_settings scope 'donation' · key 'requireMembership' · value_text 'true'/'false'. 행이 없으면 기본 켬.
//       (후원 정책 표에 컬럼을 더하지 않고 설정 표를 써서 마이그 없이 즉시 운영 — 어드민 › 후원 관리 › 후원 정책 화면에서 켜고 끈다)
// 효과: ① 모든 입구(홈·메뉴·캠페인·추모관)의 후원 창이 결제 전에 회칙 동의 가입(또는 로그인) 단계를 먼저 보인다(donate.js)
//       ② 결제 시작 API 4개(카드 일시·카드 정기·계좌이체·효성 CMS)가 비회원 요청을 거절한다 — 화면을 우회해도 막힘
//       끄면 «등불의 기적» 캠페인(extras.requireMembership)만 가입 필수로 남는다.
import { sql } from "drizzle-orm";
import { db } from "../db";

const SCOPE = "donation";
const KEY = "requireMembership";
const TTL_MS = 60 * 1000;
let cache: { value: boolean; at: number } | null = null;

export const DEFAULT_REQUIRE_MEMBERSHIP = true;

/** 현재 스위치 값 — 인스턴스별 60초 캐시(설정 저장 직후 같은 인스턴스는 즉시 갱신) */
export async function isMembershipRequired(): Promise<boolean> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let value = DEFAULT_REQUIRE_MEMBERSHIP;
  try {
    const r: any = await db.execute(sql`SELECT value_text FROM site_settings WHERE scope = ${SCOPE} AND key = ${KEY} LIMIT 1`);
    const row = (r?.rows ?? r ?? [])[0];
    if (row && row.value_text != null && String(row.value_text).trim() !== "") {
      value = String(row.value_text).trim().toLowerCase() === "true";
    }
  } catch (e: any) {
    console.warn("[donation-membership] 설정 조회 실패(기본값 사용):", e?.message || e);
  }
  cache = { value, at: Date.now() };
  return value;
}

/** 스위치 저장 — 발행값으로 바로(임시저장 단계 없음). 행이 없으면 만든다 */
export async function setMembershipRequired(value: boolean, adminId: number | null): Promise<void> {
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
      VALUES (${SCOPE}, ${KEY}, 'text', ${text}, ${"후원회원 가입 필수(모든 입구) — 후원 정책 화면에서 관리"}, 0, true, NOW(), ${adminId})`);
  }
  cache = { value, at: Date.now() };
}
