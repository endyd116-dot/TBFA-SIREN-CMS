// lib/member-classifier.ts
// ★ Phase M-12 + M-13: 회원 자동 분류 + 가입경로 매핑 + 효성 자동 회원 생성

import { eq, sql } from "drizzle-orm";
import crypto from "crypto";
import { db, members, donations } from "../db";
import { hashPassword } from "./auth";

/* ───────── 분류 카테고리 ───────── */
export type MemberCategory = "sponsor" | "regular" | "family" | "etc";
export type MemberSubtype =
  | "regular_donation"
  | "hyosung_donation"
  | "onetime_donation"
  | "volunteer"
  | "lawyer"
  | "counselor"
  | null;

/* ───────── 가입경로 코드 ───────── */
export type SignupSourceCode = "website" | "admin" | "hyosung_csv" | "event" | "etc";

/* ───────── 가입경로 코드 → ID 캐시 (5분) ───────── */
let _sourceCache: { map: Record<string, number>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getSignupSourceId(code: SignupSourceCode): Promise<number | null> {
  const now = Date.now();
  if (!_sourceCache || _sourceCache.expiresAt < now) {
    const rows: any[] = await db.execute(sql`
      SELECT id, code FROM signup_sources WHERE is_active = TRUE
    `);
    const map: Record<string, number> = {};
    for (const r of rows) map[r.code] = r.id;
    _sourceCache = { map, expiresAt: now + CACHE_TTL_MS };
  }
  return _sourceCache.map[code] ?? null;
}

/* ───────── 회원 가입 시 분류 결정 ───────── */
export interface InitialClassifyOptions {
  type: "regular" | "family" | "volunteer" | "admin";
  signupSource?: SignupSourceCode;
}

export interface ClassifyResult {
  memberCategory: MemberCategory;
  memberSubtype: MemberSubtype;
  signupSourceId: number | null;
}

export async function classifyForSignup(opts: InitialClassifyOptions): Promise<ClassifyResult> {
  const { type, signupSource = "website" } = opts;
  const sourceId = await getSignupSourceId(signupSource);

  if (type === "admin") {
    return { memberCategory: "etc", memberSubtype: null, signupSourceId: sourceId };
  }
  if (type === "family") {
    return { memberCategory: "family", memberSubtype: null, signupSourceId: sourceId };
  }
  if (type === "volunteer") {
    return { memberCategory: "etc", memberSubtype: "volunteer", signupSourceId: sourceId };
  }
  return { memberCategory: "regular", memberSubtype: null, signupSourceId: sourceId };
}

/* ───────── 후원 완료 시 sponsor로 승급 ───────── */
export type DonationKind = "hyosung" | "regular" | "onetime";

export async function upgradeToSponsor(
  memberId: number,
  donationKind: DonationKind,
): Promise<void> {
  if (!memberId) return;

  try {
    const [m] = await db
      .select({
        category: members.memberCategory,
        subtype: members.memberSubtype,
      })
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);

    if (!m) return;
    if (m.category === "family" || m.category === "etc") return;

    const PRIORITY: Record<string, number> = {
      hyosung_donation: 3,
      regular_donation: 2,
      onetime_donation: 1,
    };

    const newSubtypeMap: Record<DonationKind, MemberSubtype> = {
      hyosung: "hyosung_donation",
      regular: "regular_donation",
      onetime: "onetime_donation",
    };
    const newSubtype = newSubtypeMap[donationKind];
    if (!newSubtype) return;

    const currentPriority = PRIORITY[m.subtype || ""] || 0;
    const newPriority = PRIORITY[newSubtype];

    if (m.category === "sponsor" && currentPriority >= newPriority) {
      return;
    }

    await db.update(members).set({
      memberCategory: "sponsor",
      memberSubtype: newSubtype,
      updatedAt: new Date(),
    } as any).where(eq(members.id, memberId));
  } catch (e) {
    console.error("[member-classifier.upgradeToSponsor]", e);
  }
}

/* ───────── 회원 분류 일괄 재계산 ───────── */
export async function recomputeMemberClassification(memberId: number): Promise<ClassifyResult | null> {
  try {
    const [m] = await db.select({
      type: members.type,
      currentCategory: members.memberCategory,
    }).from(members).where(eq(members.id, memberId)).limit(1);

    if (!m) return null;

    if (m.type === "admin") {
      return { memberCategory: "etc", memberSubtype: null, signupSourceId: null };
    }
    if (m.type === "family") {
      return { memberCategory: "family", memberSubtype: null, signupSourceId: null };
    }
    if (m.type === "volunteer") {
      return { memberCategory: "etc", memberSubtype: "volunteer", signupSourceId: null };
    }

    const donationStats = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE hyosung_member_no IS NOT NULL)::int AS hyosung_count,
        COUNT(*) FILTER (WHERE type = 'regular' AND status = 'completed')::int AS regular_count,
        COUNT(*) FILTER (WHERE type = 'onetime' AND status = 'completed')::int AS onetime_count
      FROM donations
      WHERE member_id = ${memberId}
    `);
    const s: any = donationStats[0] || {};

    if ((s.hyosung_count || 0) > 0) {
      return { memberCategory: "sponsor", memberSubtype: "hyosung_donation", signupSourceId: null };
    }
    if ((s.regular_count || 0) > 0) {
      return { memberCategory: "sponsor", memberSubtype: "regular_donation", signupSourceId: null };
    }
    if ((s.onetime_count || 0) > 0) {
      return { memberCategory: "sponsor", memberSubtype: "onetime_donation", signupSourceId: null };
    }

    return { memberCategory: "regular", memberSubtype: null, signupSourceId: null };
  } catch (e) {
    console.error("[member-classifier.recomputeMemberClassification]", e);
    return null;
  }
}

/* =========================================================
   ★ M-13: 효성 CMS+ 매칭 실패 행 → 자동 회원 생성
   - 가상 이메일: hyosung-{회원번호}@auto.siren-org.kr
   - passwordHash: 임의 랜덤 (로그인 불가 — admin이 비번 발급해야 함)
   - emailVerified: false
   - 회원 분류: sponsor + hyosung_donation + signup_source='hyosung_csv'
   ========================================================= */

export interface CreateHyosungMemberInput {
  hyosungMemberNo: number;     // 효성 회원번호 (가상 이메일에 사용)
  donorName: string;            // CSV의 회원명
  phone?: string | null;        // 효성 CSV에는 일반적으로 없지만 옵션
  email?: string | null;        // 효성 CSV에 이메일이 있으면 우선 사용
}

export interface CreateHyosungMemberResult {
  ok: boolean;
  memberId?: number;
  email?: string;
  duplicate?: boolean;          // 이미 가상 이메일이 존재하는 경우
  error?: string;
}

/**
 * 효성 CSV 매칭 실패 행에 대해 회원 자동 생성
 *
 * 흐름:
 * 1. 가상 이메일 생성 (hyosung-{N}@auto.siren-org.kr)
 * 2. 중복 체크 — 이미 존재하면 해당 memberId 반환 (duplicate=true)
 * 3. 임의 password_hash 생성 (실제 로그인 불가)
 * 4. INSERT — type=regular / status=active / category=sponsor / subtype=hyosung_donation
 * 5. signup_source_id = hyosung_csv
 */
export async function createHyosungMember(
  input: CreateHyosungMemberInput,
): Promise<CreateHyosungMemberResult> {
  try {
    const { hyosungMemberNo, donorName, phone, email } = input;

    if (!hyosungMemberNo || hyosungMemberNo <= 0) {
      return { ok: false, error: "유효하지 않은 효성 회원번호" };
    }
    const safeName = (donorName || "").trim().slice(0, 50) || `효성회원_${hyosungMemberNo}`;

    /* 1. 이메일 결정 — CSV에 이메일이 있으면 우선, 없으면 가상 이메일 */
    let useEmail: string;
    if (email && email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      useEmail = email.trim().toLowerCase();
    } else {
      useEmail = `hyosung-${hyosungMemberNo}@auto.siren-org.kr`;
    }

    /* 2. 중복 체크 */
    const [existing] = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.email, useEmail))
      .limit(1);

    if (existing) {
      return {
        ok: true,
        memberId: existing.id,
        email: useEmail,
        duplicate: true,
      };
    }

    /* 3. 임의 password_hash (실제 로그인 불가) */
    const randomPw = crypto.randomBytes(32).toString("base64");
    const passwordHash = await hashPassword(randomPw);

    /* 4. signup_source_id 가져오기 */
    const sourceId = await getSignupSourceId("hyosung_csv");

    /* 5. INSERT */
    const insertPayload: any = {
      email: useEmail,
      passwordHash,
      name: safeName,
      phone: phone ? String(phone).trim().slice(0, 20) : null,
      type: "regular",
      status: "active",
      emailVerified: false,
      memberCategory: "sponsor",
      memberSubtype: "hyosung_donation",
      signupSourceId: sourceId,
      agreeEmail: true,
      agreeSms: true,
      agreeMail: false,
      memo: `[자동 생성] 효성 CSV 매칭 실패 행에서 자동 등록 (회원번호: ${hyosungMemberNo})`,
    };

    const [inserted] = await db
      .insert(members)
      .values(insertPayload)
      .returning({ id: members.id, email: members.email });

    return {
      ok: true,
      memberId: inserted.id,
      email: inserted.email,
      duplicate: false,
    };
  } catch (e: any) {
    console.error("[member-classifier.createHyosungMember]", e);
    return { ok: false, error: e?.message || "자동 회원 생성 실패" };
  }
}