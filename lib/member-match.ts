// lib/member-match.ts
// 전화번호(숫자만 비교)로 기존 회원 찾기 — 효성 계약/수납 자동 매칭의 보조, 일괄 등록 중복 병합에 공용 (2026-09-06)
//   효성 파일은 효성 회원번호로 먼저 맞추고, 번호가 없는 회원(홈페이지 가입·수기 등록)은 전화번호로 잇는다.
//   그래야 «계약 통과»가 이미 있는 회원을 두고 임시 계정을 또 만들지 않는다(2026-09-06 이현진 중복 사례).

import { sql } from "drizzle-orm";
import { db } from "../db";

export function phoneDigits(phone: string | null | undefined): string {
  return String(phone || "").replace(/[^0-9]/g, "");
}

function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

/** 전화번호 여러 개 → { 숫자전화: members.id } (탈퇴·정지 제외 · 같은 번호가 여럿이면 가장 오래된 회원) */
export async function findMemberIdsByPhones(phones: Array<string | null | undefined>): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const digits = Array.from(new Set(phones.map(phoneDigits).filter((d) => d.length >= 10)));
  if (digits.length === 0) return out;
  try {
    const res: any = await db.execute(sql`
      SELECT id, regexp_replace(phone, '[^0-9]', '', 'g') AS d
      FROM members
      WHERE status NOT IN ('withdrawn', 'suspended')
        AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY(${digits}::text[])
      ORDER BY id ASC
    `);
    for (const r of rowsOf(res)) {
      const d = String(r.d || "");
      if (d && !out.has(d)) out.set(d, Number(r.id));
    }
  } catch (e) {
    console.warn("[member-match] 전화번호 조회 실패:", (e as any)?.message);
  }
  return out;
}

/** 전화번호 하나 → members.id 또는 null */
export async function findMemberIdByPhone(phone: string | null | undefined): Promise<number | null> {
  const d = phoneDigits(phone);
  if (d.length < 10) return null;
  const map = await findMemberIdsByPhones([d]);
  return map.get(d) ?? null;
}
