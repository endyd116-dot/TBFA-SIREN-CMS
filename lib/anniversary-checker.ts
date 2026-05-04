// lib/anniversary-checker.ts
// ★ Phase M-19-7: 기념일 축하 메일 — 대상 검사 + 발송 관리
//
// 5가지 기념일 종류:
// 1. signup_1month       - 가입 1개월
// 2. signup_1year        - 가입 1주년
// 3. first_donation_1year - 첫 후원 1주년
// 4. donation_milestone  - 누적 후원액 마일스톤 (10만/50만/100만/300만/500만/1000만)
// 5. regular_donation_6months / 1year - 정기 후원 6개월/1년

import { eq, and, sql, isNotNull, gt, gte, lte, desc } from "drizzle-orm";
import { db } from "../db";
import { members, donations, anniversaryEmailsLog, billingKeys } from "../db/schema";

export const MILESTONE_AMOUNTS = [100000, 500000, 1000000, 3000000, 5000000, 10000000];

export type AnniversaryType =
  | "signup_1month"
  | "signup_1year"
  | "first_donation_1year"
  | "donation_milestone"
  | "regular_donation_6months"
  | "regular_donation_1year";

export interface AnniversaryCandidate {
  memberId: number;
  memberName: string;
  memberEmail: string;
  type: AnniversaryType;
  anniversaryDate: Date;
  milestoneAmount?: number;
  totalDonation?: number;
  regularMonths?: number;
  metadata?: Record<string, any>;
}

/* 날짜가 오늘 기준 N일 전인지 확인 (±0일 = 오늘) */
function isDaysAgo(date: Date | string, days: number): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  const target = new Date();
  target.setDate(target.getDate() - days);
  return (
    d.getFullYear() === target.getFullYear() &&
    d.getMonth() === target.getMonth() &&
    d.getDate() === target.getDate()
  );
}

/* 날짜가 N개월 전 같은 날인지 확인 */
function isMonthsAgo(date: Date | string, months: number): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  const target = new Date();
  target.setMonth(target.getMonth() - months);
  return (
    d.getFullYear() === target.getFullYear() &&
    d.getMonth() === target.getMonth() &&
    d.getDate() === target.getDate()
  );
}

/* 날짜가 N년 전 같은 날인지 확인 */
function isYearsAgo(date: Date | string, years: number): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  const target = new Date();
  target.setFullYear(target.getFullYear() - years);
  return (
    d.getFullYear() === target.getFullYear() &&
    d.getMonth() === target.getMonth() &&
    d.getDate() === target.getDate()
  );
}

/* 이미 발송된 기념일인지 체크 */
export async function hasAlreadySent(
  memberId: number,
  type: AnniversaryType,
  anniversaryDate: Date,
  milestoneAmount?: number
): Promise<boolean> {
  const dateOnly = new Date(anniversaryDate.getFullYear(), anniversaryDate.getMonth(), anniversaryDate.getDate());
  const amount = milestoneAmount || 0;

  const row: any = await db.execute(sql`
    SELECT id FROM anniversary_emails_log
    WHERE member_id = ${memberId}
      AND anniversary_type = ${type}
      AND anniversary_date = ${dateOnly}
      AND COALESCE(milestone_amount, 0) = ${amount}
    LIMIT 1
  `);
  const rows = row.rows || row || [];
  return rows.length > 0;
}

/* 가입 1개월/1주년 대상 조회 */
export async function getSignupAnniversaryCandidates(): Promise<AnniversaryCandidate[]> {
  const candidates: AnniversaryCandidate[] = [];

  const activeMembers: any[] = await db
    .select({
      id: members.id,
      name: members.name,
      email: members.email,
      createdAt: members.createdAt,
      status: members.status,
      agreeEmail: members.agreeEmail,
    })
    .from(members)
    .where(and(
      sql`${members.status} != 'withdrawn'`,
      isNotNull(members.email)
    ));

  for (const m of activeMembers) {
    if (!m.email || m.agreeEmail === false) continue;
    if (m.createdAt && isMonthsAgo(m.createdAt, 1)) {
      candidates.push({
        memberId: m.id,
        memberName: m.name || "회원",
        memberEmail: m.email,
        type: "signup_1month",
        anniversaryDate: new Date(m.createdAt),
      });
    }
    if (m.createdAt && isYearsAgo(m.createdAt, 1)) {
      candidates.push({
        memberId: m.id,
        memberName: m.name || "회원",
        memberEmail: m.email,
        type: "signup_1year",
        anniversaryDate: new Date(m.createdAt),
      });
    }
  }

  return candidates;
}

/* 첫 후원 1주년 대상 조회 */
export async function getFirstDonationAnniversaryCandidates(): Promise<AnniversaryCandidate[]> {
  const candidates: AnniversaryCandidate[] = [];

  const rows: any = await db.execute(sql`
    SELECT
      m.id AS "memberId",
      m.name AS "memberName",
      m.email AS "memberEmail",
      MIN(d.created_at) AS "firstDonationAt",
      m.agree_email AS "agreeEmail"
    FROM members m
    INNER JOIN donations d ON d.member_id = m.id
    WHERE d.status = 'completed'
      AND m.status != 'withdrawn'
      AND m.email IS NOT NULL
    GROUP BY m.id, m.name, m.email, m.agree_email
  `);

  for (const r of (rows.rows || rows || [])) {
    if (!r.memberEmail || r.agreeEmail === false) continue;
    if (r.firstDonationAt && isYearsAgo(r.firstDonationAt, 1)) {
      candidates.push({
        memberId: r.memberId,
        memberName: r.memberName || "후원자",
        memberEmail: r.memberEmail,
        type: "first_donation_1year",
        anniversaryDate: new Date(r.firstDonationAt),
      });
    }
  }

  return candidates;
}

/* 정기 후원 6개월/1년 대상 조회 (토스 빌링키 활성 기준) */
export async function getRegularDonationAnniversaryCandidates(): Promise<AnniversaryCandidate[]> {
  const candidates: AnniversaryCandidate[] = [];

  const rows: any = await db.execute(sql`
    SELECT
      bk.member_id AS "memberId",
      bk.created_at AS "billingStartAt",
      m.name AS "memberName",
      m.email AS "memberEmail",
      m.agree_email AS "agreeEmail"
    FROM billing_keys bk
    INNER JOIN members m ON m.id = bk.member_id
    WHERE bk.is_active = true
      AND m.status != 'withdrawn'
      AND m.email IS NOT NULL
  `);

  for (const r of (rows.rows || rows || [])) {
    if (!r.memberEmail || r.agreeEmail === false) continue;
    if (r.billingStartAt && isMonthsAgo(r.billingStartAt, 6)) {
      candidates.push({
        memberId: r.memberId,
        memberName: r.memberName || "후원자",
        memberEmail: r.memberEmail,
        type: "regular_donation_6months",
        anniversaryDate: new Date(r.billingStartAt),
        regularMonths: 6,
      });
    }
    if (r.billingStartAt && isYearsAgo(r.billingStartAt, 1)) {
      candidates.push({
        memberId: r.memberId,
        memberName: r.memberName || "후원자",
        memberEmail: r.memberEmail,
        type: "regular_donation_1year",
        anniversaryDate: new Date(r.billingStartAt),
        regularMonths: 12,
      });
    }
  }

  return candidates;
}
// lib/anniversary-checker.ts (Part 2) — 이어서

/* 누적 후원액 마일스톤 대상 조회 */
export async function getDonationMilestoneCandidates(): Promise<AnniversaryCandidate[]> {
  const candidates: AnniversaryCandidate[] = [];

  const rows: any = await db.execute(sql`
    SELECT
      m.id AS "memberId",
      m.name AS "memberName",
      m.email AS "memberEmail",
      m.total_donation_amount AS "totalAmount",
      m.agree_email AS "agreeEmail"
    FROM members m
    WHERE m.status != 'withdrawn'
      AND m.email IS NOT NULL
      AND m.total_donation_amount > 0
  `);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const r of (rows.rows || rows || [])) {
    if (!r.memberEmail || r.agreeEmail === false) continue;
    const total = Number(r.totalAmount || 0);

    /* 달성한 가장 큰 마일스톤 찾기 (최근 하루 내에 넘었는지 확인) */
    for (const milestone of [...MILESTONE_AMOUNTS].reverse()) {
      if (total < milestone) continue;


      /* 단순화: total이 마일스톤을 방금 넘은 경우 — 전일 합계 체크 */
      const yesterdayTotal: any = await db.execute(sql`
        SELECT COALESCE(SUM(amount), 0)::bigint AS "sum"
        FROM donations
        WHERE member_id = ${r.memberId}
          AND status = 'completed'
          AND created_at < ${today}
      `);
      const yesterdayRow = (yesterdayTotal.rows || yesterdayTotal || [{}])[0];
      const yesterdaySum = Number(yesterdayRow?.sum || 0);

      /* 어제까지는 미달, 오늘 넘었으면 마일스톤 달성 */
      if (yesterdaySum < milestone && total >= milestone) {
        candidates.push({
          memberId: r.memberId,
          memberName: r.memberName || "후원자",
          memberEmail: r.memberEmail,
          type: "donation_milestone",
          anniversaryDate: today,
          milestoneAmount: milestone,
          totalDonation: total,
        });
        break; /* 하루에 한 마일스톤만 */
      }
    }
  }

  return candidates;
}

/* 전체 기념일 대상 일괄 조회 */
export async function getAllAnniversaryCandidates(): Promise<AnniversaryCandidate[]> {
  const [signup, firstDon, regular, milestone] = await Promise.all([
    getSignupAnniversaryCandidates(),
    getFirstDonationAnniversaryCandidates(),
    getRegularDonationAnniversaryCandidates(),
    getDonationMilestoneCandidates(),
  ]);

  const all = [...signup, ...firstDon, ...regular, ...milestone];

  /* 중복 발송 제거 */
  const filtered: AnniversaryCandidate[] = [];
  for (const c of all) {
    const already = await hasAlreadySent(c.memberId, c.type, c.anniversaryDate, c.milestoneAmount);
    if (!already) filtered.push(c);
  }

  return filtered;
}

/* 발송 로그 기록 */
export async function logAnniversaryEmailSent(
  memberId: number,
  type: AnniversaryType,
  anniversaryDate: Date,
  milestoneAmount: number | undefined,
  recipientEmail: string,
  status: "sent" | "failed",
  errorMessage?: string,
  metadata?: Record<string, any>
): Promise<void> {
  const dateOnly = new Date(anniversaryDate.getFullYear(), anniversaryDate.getMonth(), anniversaryDate.getDate());

  const insertData: any = {
    memberId,
    anniversaryType: type,
    anniversaryDate: dateOnly,
    milestoneAmount: milestoneAmount || null,
    emailSentAt: new Date(),
    emailStatus: status,
    recipientEmail,
    errorMessage: errorMessage || null,
    metadata: metadata || {},
  };

  try {
    await db.insert(anniversaryEmailsLog).values(insertData);
  } catch (e) {
    console.error("[logAnniversaryEmailSent]", e);
  }
}