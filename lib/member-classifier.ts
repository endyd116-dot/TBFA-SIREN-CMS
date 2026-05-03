// lib/member-classifier.ts
// ★ Phase M-12: 회원 자동 분류 + 가입경로 매핑 헬퍼
//
// 사용처:
// 1. auth-signup.ts — 가입 시점 (member_category, signup_source_id 자동 설정)
// 2. donate-toss-confirm.ts / billing-confirm.ts — 후원 완료 시 sponsor로 승급
// 3. admin-hyosung-import.ts — 효성 매칭 시 sponsor + hyosung_donation
// 4. admin-members.ts — 관리자가 직접 추가 시 source='admin'

import { eq, and, sql } from "drizzle-orm";
import { db, members, donations } from "../db";

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
  signupSource?: SignupSourceCode;  // 기본 'website'
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
  /* type='regular' — 가입 직후엔 후원 이력 없음 → regular */
  return { memberCategory: "regular", memberSubtype: null, signupSourceId: sourceId };
}

/* ───────── 후원 완료 시 sponsor로 승급
   - donate-toss-confirm.ts 등에서 호출
   - 회원의 후원 패턴을 보고 가장 정확한 subtype 결정
   ───────── */
export type DonationKind = "hyosung" | "regular" | "onetime";

export async function upgradeToSponsor(
  memberId: number,
  donationKind: DonationKind,
): Promise<void> {
  if (!memberId) return;

  try {
    /* 현재 회원 조회 */
    const [m] = await db
      .select({
        category: members.memberCategory,
        subtype: members.memberSubtype,
      })
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);

    if (!m) return;

    /* family/admin/volunteer는 sponsor로 변경 안 함 (다중 역할 보존) */
    if (m.category === "family" || m.category === "etc") return;

    /* 이미 sponsor면 — subtype 우선순위 비교 후 더 높은 단계로 승급
       hyosung > regular > onetime */
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
      /* 이미 같거나 더 높은 단계 — 변경 안 함 */
      return;
    }

    /* 업데이트 */
    await db.update(members).set({
      memberCategory: "sponsor",
      memberSubtype: newSubtype,
      updatedAt: new Date(),
    } as any).where(eq(members.id, memberId));
  } catch (e) {
    console.error("[member-classifier.upgradeToSponsor]", e);
    /* 분류 실패는 후원 처리를 막지 않음 */
  }
}

/* ───────── 회원 분류 일괄 재계산 (관리자 도구용)
   - 특정 회원 1명의 분류를 donations 이력 기반으로 재계산
   ───────── */
export async function recomputeMemberClassification(memberId: number): Promise<ClassifyResult | null> {
  try {
    const [m] = await db.select({
      type: members.type,
      currentCategory: members.memberCategory,
    }).from(members).where(eq(members.id, memberId)).limit(1);

    if (!m) return null;

    /* 자동 변경 안 함: admin/family/volunteer */
    if (m.type === "admin") {
      return { memberCategory: "etc", memberSubtype: null, signupSourceId: null };
    }
    if (m.type === "family") {
      return { memberCategory: "family", memberSubtype: null, signupSourceId: null };
    }
    if (m.type === "volunteer") {
      return { memberCategory: "etc", memberSubtype: "volunteer", signupSourceId: null };
    }

    /* type='regular' — 후원 이력 분석 */
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