// lib/donation-matcher.ts
// ★ 6순위 #15: 후원 자동 매칭 룰 엔진
// pending_donations 행 → members(+ 직전 donations) 후보 추출 → 점수 계산
//
// 룰: name_exact / name_partial / amount_exact / date_window / account_tail4
// 가중치는 donation_matching_rules 테이블에서 동적 로드

import { db } from "../db";
import { sql } from "drizzle-orm";

/* =========================================================
   타입
   ========================================================= */

export interface MatchCandidate {
  memberId: number;
  memberName: string | null;
  score: number;            // 0.00 ~ 1.00 (가중합 정규화)
  reasons: string[];        // 매칭 이유 배열 → match_reason 200자 이내로 압축
}

export interface MatchInput {
  parsedName: string | null;
  parsedAmount: number | null;
  parsedDate: Date | null;
  parsedAccountTail4: string | null;
}

export interface MatchRuleSet {
  nameExactWeight: number;
  namePartialWeight: number;
  amountExactWeight: number;
  dateWindowWeight: number;
  dateWindowDays: number;
  accountTail4Weight: number;
}

/* =========================================================
   룰 로드 (DB 의존 — 매 import마다 호출)
   ========================================================= */

const DEFAULT_RULES: MatchRuleSet = {
  nameExactWeight: 1.00,
  namePartialWeight: 0.40,
  amountExactWeight: 0.80,
  dateWindowWeight: 0.30,
  dateWindowDays: 7,
  accountTail4Weight: 0.50,
};

export async function loadMatchingRules(): Promise<MatchRuleSet> {
  try {
    const rows: any = await db.execute(sql`
      SELECT rule_key, weight, threshold, is_active
      FROM donation_matching_rules
      WHERE is_active = true
    `);
    const list = (Array.isArray(rows) ? rows : (rows as any).rows || []) as Array<{
      rule_key: string;
      weight: any;
      threshold: any;
      is_active: boolean;
    }>;
    const map: Record<string, { weight: number; threshold: number | null }> = {};
    for (const r of list) {
      map[r.rule_key] = {
        weight: Number(r.weight) || 0,
        threshold: r.threshold === null || r.threshold === undefined ? null : Number(r.threshold),
      };
    }
    return {
      nameExactWeight: map.name_exact?.weight ?? DEFAULT_RULES.nameExactWeight,
      namePartialWeight: map.name_partial?.weight ?? DEFAULT_RULES.namePartialWeight,
      amountExactWeight: map.amount_exact?.weight ?? DEFAULT_RULES.amountExactWeight,
      dateWindowWeight: map.date_window?.weight ?? DEFAULT_RULES.dateWindowWeight,
      dateWindowDays: map.date_window?.threshold ?? DEFAULT_RULES.dateWindowDays,
      accountTail4Weight: map.account_tail4?.weight ?? DEFAULT_RULES.accountTail4Weight,
    };
  } catch {
    /* 룰 테이블이 없거나 로드 실패 → 기본값 */
    return { ...DEFAULT_RULES };
  }
}

/* =========================================================
   후보 추출 (이름 기반 우선)
   ========================================================= */

interface CandidateRow {
  member_id: number;
  member_name: string | null;
  last_donation_amount: number | null;
  last_donation_date: Date | null;
  last_donor_phone: string | null;
}

function normalizeNameForMatch(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/[\s·.\-_()]/g, "").trim();
}

/**
 * 이름이 있는 경우 ILIKE 부분일치로 후보 회원 추출 (최대 50개)
 * 직전 후원금액·날짜는 donations 테이블에서 LATERAL JOIN으로 가져옴
 */
async function fetchCandidatesByName(parsedName: string): Promise<CandidateRow[]> {
  const cleaned = normalizeNameForMatch(parsedName);
  if (cleaned.length < 2) return [];

  /* 이름은 보통 2~4자 한글 → 부분일치 */
  const pattern = `%${cleaned}%`;

  try {
    const rows: any = await db.execute(sql`
      SELECT
        m.id AS member_id,
        m.name AS member_name,
        m.phone AS last_donor_phone,
        (
          SELECT d.amount FROM donations d
          WHERE d.member_id = m.id AND d.status = 'completed'
          ORDER BY d.created_at DESC LIMIT 1
        ) AS last_donation_amount,
        (
          SELECT d.created_at FROM donations d
          WHERE d.member_id = m.id AND d.status = 'completed'
          ORDER BY d.created_at DESC LIMIT 1
        ) AS last_donation_date
      FROM members m
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(m.name,' ',''),'·',''),'.',''),'-',''),'_','') ILIKE ${pattern}
      LIMIT 50
    `);
    return (Array.isArray(rows) ? rows : (rows as any).rows || []) as CandidateRow[];
  } catch {
    return [];
  }
}

/* =========================================================
   점수 계산
   ========================================================= */

function scoreCandidate(
  candidate: CandidateRow,
  input: MatchInput,
  rules: MatchRuleSet
): MatchCandidate {
  const reasons: string[] = [];
  let totalWeight = 0;
  let totalCap = 0;

  /* 이름 매칭 */
  const inputName = normalizeNameForMatch(input.parsedName);
  const candName = normalizeNameForMatch(candidate.member_name);
  if (inputName && candName) {
    if (inputName === candName) {
      totalWeight += rules.nameExactWeight;
      reasons.push("이름 완전일치");
    } else if (
      candName.length >= 2 && inputName.length >= 2 &&
      (candName.includes(inputName) || inputName.includes(candName))
    ) {
      totalWeight += rules.namePartialWeight;
      reasons.push("이름 부분일치");
    }
    totalCap += rules.nameExactWeight;
  }

  /* 금액 매칭 (직전 후원금액과 비교) */
  if (input.parsedAmount && candidate.last_donation_amount) {
    if (Math.abs(input.parsedAmount - Number(candidate.last_donation_amount)) === 0) {
      totalWeight += rules.amountExactWeight;
      reasons.push(`금액 완전일치(${input.parsedAmount.toLocaleString()}원)`);
    }
    totalCap += rules.amountExactWeight;
  }

  /* 날짜 윈도우 매칭 */
  if (input.parsedDate && candidate.last_donation_date) {
    const diffMs = Math.abs(input.parsedDate.getTime() - new Date(candidate.last_donation_date).getTime());
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= rules.dateWindowDays) {
      /* 날짜 가까울수록 가중치 비례 (0~1 사이) */
      const factor = Math.max(0, 1 - diffDays / rules.dateWindowDays);
      totalWeight += rules.dateWindowWeight * factor;
      reasons.push(`최근 후원 ${diffDays}일 이내`);
    }
    totalCap += rules.dateWindowWeight;
  }

  /* 계좌끝4 매칭 — 후원자 phone 끝4자리와 비교 (계좌번호 직접 비교는 데이터 없음) */
  if (input.parsedAccountTail4 && candidate.last_donor_phone) {
    const phoneTail = (candidate.last_donor_phone || "").replace(/[^\d]/g, "").slice(-4);
    if (phoneTail && phoneTail === input.parsedAccountTail4) {
      totalWeight += rules.accountTail4Weight;
      reasons.push("연락처 끝4자리 일치");
    }
    totalCap += rules.accountTail4Weight;
  }

  /* 정규화: 0~1 */
  const score = totalCap > 0 ? Math.min(1, totalWeight / totalCap) : 0;

  return {
    memberId: candidate.member_id,
    memberName: candidate.member_name,
    score: Math.round(score * 100) / 100,
    reasons,
  };
}

/* =========================================================
   메인 진입점
   ========================================================= */

/**
 * 단일 pending 행에 대한 최적 매칭 후보 1건 반환 (없으면 null)
 * 점수 0.50 미만이면 null (false-positive 회피)
 */
export async function matchPendingDonation(
  input: MatchInput,
  rules?: MatchRuleSet
): Promise<MatchCandidate | null> {
  const r = rules || (await loadMatchingRules());

  if (!input.parsedName) return null;
  const candidates = await fetchCandidatesByName(input.parsedName);
  if (candidates.length === 0) return null;

  const scored = candidates
    .map(c => scoreCandidate(c, input, r))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0.50) return null;

  /* 동점 2위가 0.05 이내면 모호 → null */
  const second = scored[1];
  if (second && best.score - second.score < 0.05) return null;

  return best;
}

/**
 * 매칭 이유 배열 → 200자 이내 단일 문자열
 */
export function summarizeReasons(reasons: string[]): string {
  const joined = reasons.join(" / ");
  return joined.length > 200 ? joined.slice(0, 197) + "..." : joined;
}
