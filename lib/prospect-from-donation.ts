// lib/prospect-from-donation.ts
// ★ 2026-06-26: 일시(단건) 후원 완료 시 후원자를 '예비 후원자'로 자동 등록(보장).
//
// 배경: 예비 후원자 명단은 members.donor_type='prospect' 회원 기반인데, 비회원(게스트)
//   일시후원은 회원 레코드를 안 만들어 명단에 안 떴음(Swain 지적). 이 헬퍼가 그 빈틈을 메움.
//
// 동작:
//   1) 후원이 이미 회원과 연결 → 그 회원 재분류(완료 onetime 보유 → prospect/onetime). 즉시 반영.
//   2) 비회원(게스트) → 전화·이메일로 기존 회원 매칭
//        - 매칭 성공: 후원을 그 회원에 연결 + 재분류
//        - 매칭 실패: 새 예비 후원자(회원) 생성(admin-prospect-donor-create 패턴) + 후원 연결
//
// 멱등: 전화/이메일 매칭이 재생성을 막음(같은 사람 재호출해도 중복 회원 안 만듦).
//   일시후원 등록은 이름·전화·이메일 필수라 게스트도 매칭 가능 → 안전.
//
// fire-and-forget: 실패해도 결제/완료 트랜잭션에 영향 0(throw 안 함).

import { sql } from "drizzle-orm";
import { db } from "../db";
import { safeReevaluate } from "./donor-status";

export interface ProspectDonationInput {
  donationId: number;
  memberId?: number | null;
  donorName?: string | null;
  donorEmail?: string | null;
  donorPhone?: string | null;
  /** 유입 경로 표시(예: 'onetime_donation') */
  entryPath?: string | null;
}

export async function ensureProspectFromDonation(input: ProspectDonationInput): Promise<void> {
  try {
    /* 1) 이미 회원 연결 → 재분류만 (완료 onetime 보유 → prospect/onetime) */
    if (input.memberId && Number(input.memberId) > 0) {
      await safeReevaluate(Number(input.memberId), "donation-onetime-linked");
      return;
    }

    const email = input.donorEmail ? String(input.donorEmail).trim() : "";
    const phone = input.donorPhone ? String(input.donorPhone).trim() : "";
    const phoneDigits = phone.replace(/[^0-9]/g, "");
    const name = (input.donorName ? String(input.donorName).trim() : "").slice(0, 100) || "후원자";
    const entryPath = (input.entryPath || "onetime_donation").slice(0, 50);

    /* 2) 기존 회원 매칭 (이메일 대소문자 무시 / 전화 숫자만 비교) */
    let matchedId = 0;
    if (email || phoneDigits) {
      const r: any = await db.execute(sql`
        SELECT id FROM members
        WHERE (${email}::text <> '' AND LOWER(email) = LOWER(${email}))
           OR (${phoneDigits}::text <> '' AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = ${phoneDigits})
        ORDER BY id ASC
        LIMIT 1
      `);
      matchedId = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    }

    if (matchedId > 0) {
      /* 후원을 기존 회원에 연결(미연결 시) + 재분류 */
      await db.execute(sql`
        UPDATE donations SET member_id = ${matchedId}, updated_at = NOW()
        WHERE id = ${input.donationId} AND member_id IS NULL
      `);
      await safeReevaluate(matchedId, "donation-onetime-match");
      return;
    }

    /* 3) 새 예비 후원자 생성 + 후원 연결 (prospect_entry_path 컬럼 없으면 폴백) */
    let newId = 0;
    try {
      /* ★ 2026-06-26: 일시 후원자 = 마케팅 수신 자동 동의(Swain). 신규 생성 시 명시 ON.
         (기존 회원에 연결되는 경우는 그들의 기존 동의/거부를 덮어쓰지 않음 — 위 매칭 분기) */
      /* 일시후원=마케팅 동의(Swain). 문자 1차 너처링 위해 전화 있으면 인증·카톡 동의도 ON
         (후원 시 직접 입력한 번호 + 동의 기반). */
      const phoneVer = phone ? sql`NOW()` : sql`NULL`;
      const ins: any = await db.execute(sql`
        INSERT INTO members (
          name, email, phone, type, status,
          donor_type, prospect_subtype, prospect_entry_path,
          agree_email, agree_sms, phone_verified_at, kakao_marketing_consent_at,
          donor_evaluated_at, created_at, updated_at
        ) VALUES (
          ${name}, ${email || null}, ${phone || null}, 'regular', 'active',
          'prospect', 'onetime', ${entryPath},
          true, true, ${phoneVer}, ${phoneVer},
          NOW(), NOW(), NOW()
        )
        RETURNING id
      `);
      newId = Number((ins?.rows ?? ins ?? [])[0]?.id) || 0;
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.includes("prospect_entry_path")) {
        const phoneVer2 = phone ? sql`NOW()` : sql`NULL`;
        const ins2: any = await db.execute(sql`
          INSERT INTO members (
            name, email, phone, type, status,
            donor_type, prospect_subtype,
            agree_email, agree_sms, phone_verified_at, kakao_marketing_consent_at,
            donor_evaluated_at, created_at, updated_at
          ) VALUES (
            ${name}, ${email || null}, ${phone || null}, 'regular', 'active',
            'prospect', 'onetime',
            true, true, ${phoneVer2}, ${phoneVer2},
            NOW(), NOW(), NOW()
          )
          RETURNING id
        `);
        newId = Number((ins2?.rows ?? ins2 ?? [])[0]?.id) || 0;
      } else {
        throw err;
      }
    }

    if (newId > 0) {
      await db.execute(sql`
        UPDATE donations SET member_id = ${newId}, updated_at = NOW()
        WHERE id = ${input.donationId} AND member_id IS NULL
      `);
    }
  } catch (e: any) {
    console.warn("[prospect-from-donation] 예비후원자 등록 실패(무시):", e?.message || e);
  }
}
