// lib/potential-donor-link.ts
// 2026-10-18: 잠재 후원자(potential_donors) ↔ 회원(members) 자동 연결 — 전화(숫자만)·이메일 일치
//
// 배경: 잠재 후원자가 회원 가입·일시 후원·정기 약정으로 «전환»돼도 운영자가 표에서 「회원연결」을 손으로 눌러야 했다
//   (Swain: 수동 연결은 의미 없음). 너처링 엔진(syncPotentialLeads·매일 KST 08:00)이 미연결 잠재를 회원과 매칭하거나
//   리드 회원을 만들어 연결하지만 하루 지연이 있다. 이 모듈은
//   ① 회원이 생기거나(가입·관리자 등록·일괄·등불·효성 자동 생성) 후원 상태가 재평가되는 순간(reevaluateDonorType) 즉시 연결
//   ② 운영자가 「자동 매칭 실행」을 누르면 미연결 잠재 전체를 일괄 연결.
// 규칙: 전화는 숫자만 비교(010-1234-5678 = 01012345678), 이메일은 대소문자 무시. 이름은 비교하지 않는다(오타·개명 흡수).
//   placeholder 메일(@noemail.*, @lantern.invalid)은 비교에서 제외. 이미 연결된 잠재(linked_member_id 있음)는 건드리지 않는다.
//   linked_by NULL = 자동 연결 표시(과거 수동 연결은 linked_by에 관리자 id).
// 실패해도 throw 하지 않는 safe 래퍼 제공 — 가입·결제 흐름에 영향 0.
import { sql } from "drizzle-orm";
import { db } from "../db";

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];
export const phoneDigits = (p: unknown): string => String(p ?? "").replace(/[^0-9]/g, "");
const isPlaceholderEmail = (e: string) => /@noemail\./i.test(e) || /@lantern\.invalid$/i.test(e);

/** 회원 1명 기준: 같은 전화·이메일의 미연결 잠재를 이 회원에 연결. 연결된 잠재 id 목록 반환 */
export async function linkPotentialDonorsForMember(
  memberId: number,
  hint?: { phone?: string | null; email?: string | null },
): Promise<number[]> {
  if (!Number.isInteger(memberId) || memberId <= 0) return [];
  let phone = phoneDigits(hint?.phone);
  let email = String(hint?.email || "").trim().toLowerCase();
  if (!phone && !email) {
    const m = rowsOf(await db.execute(sql`SELECT phone, email FROM members WHERE id = ${memberId} LIMIT 1`))[0];
    if (!m) return [];
    phone = phoneDigits(m.phone);
    email = String(m.email || "").trim().toLowerCase();
  }
  if (email && isPlaceholderEmail(email)) email = "";
  if (!phone && !email) return [];

  const rs = await db.execute(sql`
    UPDATE potential_donors
       SET linked_member_id = ${memberId}, linked_at = NOW(), linked_by = NULL, updated_at = NOW()
     WHERE linked_member_id IS NULL
       AND (
         (${phone}::text <> '' AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = ${phone})
         OR (${email}::text <> '' AND LOWER(COALESCE(email, '')) = ${email})
       )
    RETURNING id`);
  return rowsOf(rs).map((x) => Number(x.id)).filter((n) => Number.isFinite(n) && n > 0);
}

/** fire-and-forget 래퍼 — 훅 호출부용(실패 무시·로그만) */
export async function safeLinkPotentialDonors(
  memberId: number | null | undefined,
  source: string,
  hint?: { phone?: string | null; email?: string | null },
): Promise<void> {
  if (!memberId) return;
  try {
    const ids = await linkPotentialDonorsForMember(Number(memberId), hint);
    if (ids.length) console.log(`[potential-link] ${source}: member#${memberId} ← 잠재 ${ids.join(",")} 자동 연결`);
  } catch (e: any) {
    console.warn(`[potential-link] ${source}: member#${memberId} 연결 실패 — ${e?.message || e}`);
  }
}

export interface AutoLinkResult {
  scanned: number;   // 연락처가 있는 미연결 잠재 수(실행 전)
  linked: number;    // 이번에 연결된 수
  details: { potentialId: number; memberId: number; by: "phone" | "email" }[]; // 최대 100건
}

/** 미연결 잠재 전체 일괄 자동 연결(운영자 버튼·크론용). 회원이 여럿 겹치면 정기 > 예비 > 그 외, 실계정 > 리드 순으로 1명 */
export async function autoLinkAllPotentialDonors(limit = 2000): Promise<AutoLinkResult> {
  const scannedRow = rowsOf(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM potential_donors
     WHERE linked_member_id IS NULL AND (COALESCE(phone, '') <> '' OR COALESCE(email, '') <> '')`))[0];
  const scanned = Number(scannedRow?.n) || 0;

  const rs = await db.execute(sql`
    WITH pd AS (
      SELECT id,
             regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') AS pdigits,
             LOWER(NULLIF(TRIM(COALESCE(email, '')), '')) AS pemail
        FROM potential_donors
       WHERE linked_member_id IS NULL
         AND (COALESCE(phone, '') <> '' OR COALESCE(email, '') <> '')
       ORDER BY id ASC
       LIMIT ${limit}
    ), mm AS (
      SELECT id, donor_type,
             regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') AS mdigits,
             LOWER(COALESCE(email, '')) AS memail,
             (COALESCE(email, '') ILIKE '%@noemail.%' OR COALESCE(email, '') ILIKE '%@lantern.invalid') AS is_placeholder
        FROM members
       WHERE status <> 'withdrawn'
    )
    SELECT pd.id AS potential_id, c.member_id, c.match_by
      FROM pd
      JOIN LATERAL (
        SELECT mm.id AS member_id,
               CASE WHEN pd.pdigits <> '' AND mm.mdigits = pd.pdigits THEN 'phone' ELSE 'email' END AS match_by
          FROM mm
         WHERE (pd.pdigits <> '' AND mm.mdigits = pd.pdigits)
            OR (pd.pemail IS NOT NULL AND NOT mm.is_placeholder AND mm.memail = pd.pemail)
         ORDER BY CASE mm.donor_type WHEN 'regular' THEN 0 WHEN 'prospect' THEN 1 ELSE 2 END,
                  mm.is_placeholder ASC, mm.id ASC
         LIMIT 1
      ) c ON TRUE`);
  const matches = rowsOf(rs);

  let linked = 0;
  const details: AutoLinkResult["details"] = [];
  for (const m of matches) {
    const pid = Number(m.potential_id);
    const mid = Number(m.member_id);
    if (!pid || !mid) continue;
    const u = rowsOf(await db.execute(sql`
      UPDATE potential_donors
         SET linked_member_id = ${mid}, linked_at = NOW(), linked_by = NULL, updated_at = NOW()
       WHERE id = ${pid} AND linked_member_id IS NULL
      RETURNING id`));
    if (u.length) {
      linked++;
      if (details.length < 100) details.push({ potentialId: pid, memberId: mid, by: m.match_by === "phone" ? "phone" : "email" });
    }
  }
  return { scanned, linked, details };
}

export interface EnsureLeadsResult { scanned: number; linked: number; created: number }

/** 이벤트 참여 잠재 중 회원 기록이 없는 사람을 연락 가능한 리드 회원으로 만들어 연결(멱등) — 발송 수신자 준비용.
 *  너처링 syncPotentialLeads와 같은 규칙(전화·이메일로 기존 회원 매칭 → 없으면 로그인 없는 리드 회원 생성·문자/카톡 동의 ON). */
export async function ensureLeadMembersForEvents(eventNames: string[]): Promise<EnsureLeadsResult> {
  const names = [...new Set(eventNames.map((s) => String(s || "").trim()).filter(Boolean))];
  const out: EnsureLeadsResult = { scanned: 0, linked: 0, created: 0 };
  if (!names.length) return out;
  const rows = rowsOf(await db.execute(sql`
    SELECT id, name, phone, email, event_name FROM potential_donors
     WHERE linked_member_id IS NULL AND event_name IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)})
       AND (COALESCE(phone, '') <> '' OR COALESCE(email, '') <> '')
     ORDER BY id ASC LIMIT 3000`));
  out.scanned = rows.length;
  for (const pd of rows) {
    try {
      const realEmail = String(pd.email || "").trim();
      const phone = String(pd.phone || "").trim();
      const digits = phoneDigits(phone);
      const email = realEmail && !isPlaceholderEmail(realEmail) ? realEmail : "";
      if (!digits && !email) continue;
      let memberId = Number(rowsOf(await db.execute(sql`
        SELECT id FROM members
         WHERE status <> 'withdrawn' AND (
           (${email}::text <> '' AND LOWER(email) = LOWER(${email}))
           OR (${digits}::text <> '' AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = ${digits}))
         ORDER BY CASE donor_type WHEN 'regular' THEN 0 WHEN 'prospect' THEN 1 ELSE 2 END,
                  (COALESCE(email, '') ILIKE '%@noemail.%') ASC, id ASC
         LIMIT 1`))[0]?.id) || 0;
      if (!memberId) {
        const ins = rowsOf(await db.execute(sql`
          INSERT INTO members (name, email, phone, password_hash, type, status, donor_type, prospect_entry_path, prospect_event_name,
                               agree_email, agree_sms, phone_verified_at, kakao_marketing_consent_at, donor_evaluated_at, memo, created_at, updated_at)
          VALUES (${(String(pd.name || "").trim() || "후원자").slice(0, 100)}, ${email || `lead-${pd.id}@noemail.tbfa.local`}, ${phone || null}, ${"!nurture-lead-no-login"},
                  'regular', 'active', 'none', 'potential_lead', ${String(pd.event_name || "").slice(0, 150) || null},
                  ${!!email}, true, ${digits ? sql`NOW()` : sql`NULL`}, ${digits ? sql`NOW()` : sql`NULL`}, NOW(),
                  ${`[잠재 이벤트 참여] ${pd.event_name || ""} — 발송 수신자 준비로 자동 생성(로그인 없음)`}, NOW(), NOW())
          RETURNING id`));
        memberId = Number(ins[0]?.id) || 0;
        if (memberId) out.created++;
      }
      if (memberId) {
        const u = rowsOf(await db.execute(sql`
          UPDATE potential_donors SET linked_member_id = ${memberId}, linked_at = NOW(), linked_by = NULL, updated_at = NOW()
           WHERE id = ${pd.id} AND linked_member_id IS NULL RETURNING id`));
        if (u.length) out.linked++;
      }
    } catch (e: any) { console.warn(`[potential-link] 이벤트 리드 준비 실패 pd=${pd.id}: ${e?.message || e}`); }
  }
  return out;
}
