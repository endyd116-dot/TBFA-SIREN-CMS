// lib/report-data-collector.ts
// ★ Phase M-19-3: 활동보고서용 데이터 수집 헬퍼
// - 기간 지정 시 모든 도메인의 통계를 일괄 집계 (Promise.all 병렬)
// - 분기/반기/연간/자유 기간 모두 지원
// - STEP 2(AI 분석) + STEP 3(PDF) 모두에서 재사용

import { sql } from "drizzle-orm";
import { db } from "../db";

/* ───────── 타입 정의 ───────── */
export interface ReportPeriod {
  startDate: Date;
  endDate: Date;
  type: "quarterly" | "half" | "annual" | "custom";
  label: string;
}

export interface DonationStats {
  totalAmount: number;
  totalCount: number;
  donorCount: number;
  regularCount: number;
  onetimeCount: number;
  avgAmount: number;
  maxAmount: number;
  minAmount: number;
  byPayMethod: { card: number; cms: number; bank: number };
  monthlyTrend: Array<{ month: string; amount: number; count: number }>;
  /* 비교: 직전 동일 기간 대비 (트렌드 분석용) */
  prevPeriodAmount: number;
  growthRate: number | null;
}

export interface MemberStats {
  newMembersCount: number;
  totalMembersAtEnd: number;
  withdrawnCount: number;
  byCategory: { sponsor: number; regular: number; family: number; etc: number };
  bySourceTop5: Array<{ label: string; count: number }>;
  retentionRate: number | null;
}

export interface SupportStats {
  totalCount: number;
  byCategory: { counseling: number; legal: number; scholarship: number; other: number };
  byStatus: {
    submitted: number; reviewing: number; matched: number;
    in_progress: number; completed: number; rejected: number;
  };
  avgProcessingDays: number | null;
  urgentCount: number;
  completionRate: number | null;
}

export interface SirenStats {
  incident: { total: number; sirenRequested: number; responded: number; criticalHigh: number };
  harassment: { total: number; sirenRequested: number; responded: number; criticalHigh: number };
  legal: { total: number; sirenRequested: number; matched: number; urgent: number };
  board: { totalPosts: number; totalComments: number; pinnedCount: number };
}

export interface CampaignStats {
  activeCampaigns: number;
  closedCampaigns: number;
  totalRaised: number;
  totalDonors: number;
  topCampaigns: Array<{
    id: number;
    title: string;
    type: string;
    raisedAmount: number;
    goalAmount: number | null;
    progressPercent: number | null;
    donorCount: number;
  }>;
}

export interface ReportData {
  period: ReportPeriod;
  donations: DonationStats;
  members: MemberStats;
  support: SupportStats;
  siren: SirenStats;
  campaigns: CampaignStats;
  generatedAt: Date;
}

/* ───────── 기간 헬퍼 ───────── */

export function periodForQuarter(year: number, quarter: 1 | 2 | 3 | 4): ReportPeriod {
  const startMonth = (quarter - 1) * 3;
  const startDate = new Date(year, startMonth, 1, 0, 0, 0);
  const endDate = new Date(year, startMonth + 3, 0, 23, 59, 59);
  return { startDate, endDate, type: "quarterly", label: `${year}년 ${quarter}분기` };
}

export function periodForHalf(year: number, half: 1 | 2): ReportPeriod {
  const startMonth = half === 1 ? 0 : 6;
  const startDate = new Date(year, startMonth, 1, 0, 0, 0);
  const endDate = new Date(year, startMonth + 6, 0, 23, 59, 59);
  return {
    startDate, endDate, type: "half",
    label: `${year}년 ${half === 1 ? "상" : "하"}반기`,
  };
}

export function periodForYear(year: number): ReportPeriod {
  return {
    startDate: new Date(year, 0, 1, 0, 0, 0),
    endDate: new Date(year, 11, 31, 23, 59, 59),
    type: "annual",
    label: `${year}년 연간`,
  };
}

export function periodForCustom(startDate: Date, endDate: Date, label?: string): ReportPeriod {
  return {
    startDate,
    endDate,
    type: "custom",
    label: label || `${formatDate(startDate)} ~ ${formatDate(endDate)}`,
  };
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

/* 직전 동일 기간 계산 (성장률 비교용) */
function previousPeriod(period: ReportPeriod): { startDate: Date; endDate: Date } {
  const ms = period.endDate.getTime() - period.startDate.getTime();
  return {
    startDate: new Date(period.startDate.getTime() - ms - 1),
    endDate: new Date(period.startDate.getTime() - 1),
  };
}

/* ───────── 후원 통계 ───────── */
async function collectDonationStats(period: ReportPeriod): Promise<DonationStats> {
  const aggResult: any = await db.execute(sql`
    SELECT
      COALESCE(SUM(amount), 0)::bigint AS "totalAmount",
      COUNT(*)::int AS "totalCount",
      COUNT(DISTINCT COALESCE(member_id, 0))::int AS "donorCount",
      COUNT(*) FILTER (WHERE type = 'regular')::int AS "regularCount",
      COUNT(*) FILTER (WHERE type = 'onetime')::int AS "onetimeCount",
      COALESCE(AVG(amount), 0)::int AS "avgAmount",
      MAX(amount) AS "maxAmount",
      MIN(amount) AS "minAmount",
      COALESCE(SUM(amount) FILTER (WHERE pay_method = 'card'), 0)::bigint AS "byCard",
      COALESCE(SUM(amount) FILTER (WHERE pay_method = 'cms'), 0)::bigint AS "byCms",
      COALESCE(SUM(amount) FILTER (WHERE pay_method = 'bank'), 0)::bigint AS "byBank"
    FROM donations
    WHERE status = 'completed'
      AND created_at >= ${period.startDate}
      AND created_at <= ${period.endDate}
  `);
  const a: any = aggResult.rows ? aggResult.rows[0] : aggResult[0] || {};

  /* 월별 추이 */
  const trendResult: any = await db.execute(sql`
    SELECT
      TO_CHAR(created_at, 'YYYY-MM') AS "month",
      COALESCE(SUM(amount), 0)::bigint AS "amount",
      COUNT(*)::int AS "count"
    FROM donations
    WHERE status = 'completed'
      AND created_at >= ${period.startDate}
      AND created_at <= ${period.endDate}
    GROUP BY TO_CHAR(created_at, 'YYYY-MM')
    ORDER BY 1 ASC
  `);
  const trendRows = trendResult.rows || trendResult || [];

  /* 직전 기간 대비 성장률 */
  const prev = previousPeriod(period);
  const prevResult: any = await db.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::bigint AS "prevAmount"
    FROM donations
    WHERE status = 'completed'
      AND created_at >= ${prev.startDate}
      AND created_at <= ${prev.endDate}
  `);
  const p: any = prevResult.rows ? prevResult.rows[0] : prevResult[0] || {};
  const prevAmount = Number(p.prevAmount || 0);
  const currAmount = Number(a.totalAmount || 0);
  const growthRate = prevAmount > 0
    ? Math.round(((currAmount - prevAmount) / prevAmount) * 1000) / 10
    : null;

  return {
    totalAmount: currAmount,
    totalCount: Number(a.totalCount || 0),
    donorCount: Number(a.donorCount || 0),
    regularCount: Number(a.regularCount || 0),
    onetimeCount: Number(a.onetimeCount || 0),
    avgAmount: Number(a.avgAmount || 0),
    maxAmount: Number(a.maxAmount || 0),
    minAmount: Number(a.minAmount || 0),
    byPayMethod: {
      card: Number(a.byCard || 0),
      cms: Number(a.byCms || 0),
      bank: Number(a.byBank || 0),
    },
    monthlyTrend: trendRows.map((r: any) => ({
      month: r.month,
      amount: Number(r.amount || 0),
      count: r.count || 0,
    })),
    prevPeriodAmount: prevAmount,
    growthRate,
  };
}

/* ───────── 회원 통계 ───────── */
async function collectMemberStats(period: ReportPeriod): Promise<MemberStats> {
  const newRow: any = await db.execute(sql`
    SELECT
      COUNT(*)::int AS "newCount",
      COUNT(*) FILTER (WHERE member_category = 'sponsor')::int AS "sponsorCount",
      COUNT(*) FILTER (WHERE member_category = 'regular')::int AS "regularCount",
      COUNT(*) FILTER (WHERE member_category = 'family')::int AS "familyCount",
      COUNT(*) FILTER (WHERE member_category = 'etc')::int AS "etcCount"
    FROM members
    WHERE created_at >= ${period.startDate} AND created_at <= ${period.endDate}
  `);
  const n: any = newRow.rows ? newRow.rows[0] : newRow[0] || {};

  const totalRow: any = await db.execute(sql`
    SELECT COUNT(*)::int AS "total"
    FROM members
    WHERE created_at <= ${period.endDate} AND status != 'withdrawn'
  `);
  const t: any = totalRow.rows ? totalRow.rows[0] : totalRow[0] || {};

  const wdRow: any = await db.execute(sql`
    SELECT COUNT(*)::int AS "wd"
    FROM members
    WHERE withdrawn_at >= ${period.startDate} AND withdrawn_at <= ${period.endDate}
  `);
  const w: any = wdRow.rows ? wdRow.rows[0] : wdRow[0] || {};

  const sourceRows: any = await db.execute(sql`
    SELECT
      COALESCE(s.label, '미지정') AS "label",
      COUNT(m.id)::int AS "count"
    FROM members m
    LEFT JOIN signup_sources s ON s.id = m.signup_source_id
    WHERE m.created_at >= ${period.startDate} AND m.created_at <= ${period.endDate}
    GROUP BY COALESCE(s.label, '미지정')
    ORDER BY 2 DESC
    LIMIT 5
  `);
  const srcRows = sourceRows.rows || sourceRows || [];

  /* 유지율: (기간 시작 시점 활성 회원 중 종료 시점에도 활성인 비율) */
  const retainRow: any = await db.execute(sql`
    SELECT
      COUNT(*)::int AS "startActive",
      COUNT(*) FILTER (WHERE status != 'withdrawn' OR (withdrawn_at IS NOT NULL AND withdrawn_at > ${period.endDate}))::int AS "stillActive"
    FROM members
    WHERE created_at < ${period.startDate}
  `);
  const r: any = retainRow.rows ? retainRow.rows[0] : retainRow[0] || {};
  const startActive = Number(r.startActive || 0);
  const stillActive = Number(r.stillActive || 0);
  const retentionRate = startActive > 0
    ? Math.round((stillActive / startActive) * 1000) / 10
    : null;

  return {
    newMembersCount: Number(n.newCount || 0),
    totalMembersAtEnd: Number(t.total || 0),
    withdrawnCount: Number(w.wd || 0),
    byCategory: {
      sponsor: Number(n.sponsorCount || 0),
      regular: Number(n.regularCount || 0),
      family: Number(n.familyCount || 0),
      etc: Number(n.etcCount || 0),
    },
    bySourceTop5: srcRows.map((rr: any) => ({
      label: rr.label || "미지정",
      count: Number(rr.count || 0),
    })),
    retentionRate,
  };
}

/* ───────── 지원 사업 통계 ───────── */
async function collectSupportStats(period: ReportPeriod): Promise<SupportStats> {
  const r: any = await db.execute(sql`
    SELECT
      COUNT(*)::int AS "totalCount",
      COUNT(*) FILTER (WHERE category = 'counseling')::int AS "counseling",
      COUNT(*) FILTER (WHERE category = 'legal')::int AS "legal",
      COUNT(*) FILTER (WHERE category = 'scholarship')::int AS "scholarship",
      COUNT(*) FILTER (WHERE category = 'other')::int AS "other",
      COUNT(*) FILTER (WHERE status = 'submitted')::int AS "submitted",
      COUNT(*) FILTER (WHERE status = 'reviewing')::int AS "reviewing",
      COUNT(*) FILTER (WHERE status = 'matched')::int AS "matched",
      COUNT(*) FILTER (WHERE status = 'in_progress')::int AS "in_progress",
      COUNT(*) FILTER (WHERE status = 'completed')::int AS "completed",
      COUNT(*) FILTER (WHERE status = 'rejected')::int AS "rejected",
      COUNT(*) FILTER (WHERE priority = 'urgent')::int AS "urgent",
      AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 86400) FILTER (WHERE completed_at IS NOT NULL) AS "avgDays"
    FROM support_requests
    WHERE created_at >= ${period.startDate} AND created_at <= ${period.endDate}
  `);
  const s: any = r.rows ? r.rows[0] : r[0] || {};

  const total = Number(s.totalCount || 0);
  const completed = Number(s.completed || 0);
  const completionRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : null;

  return {
    totalCount: total,
    byCategory: {
      counseling: Number(s.counseling || 0),
      legal: Number(s.legal || 0),
      scholarship: Number(s.scholarship || 0),
      other: Number(s.other || 0),
    },
    byStatus: {
      submitted: Number(s.submitted || 0),
      reviewing: Number(s.reviewing || 0),
      matched: Number(s.matched || 0),
      in_progress: Number(s.in_progress || 0),
      completed: completed,
      rejected: Number(s.rejected || 0),
    },
    avgProcessingDays: s.avgDays ? Math.round(Number(s.avgDays) * 10) / 10 : null,
    urgentCount: Number(s.urgent || 0),
    completionRate,
  };
}

/* ───────── 사이렌 4종 통계 ───────── */
async function collectSirenStats(period: ReportPeriod): Promise<SirenStats> {
  const ir: any = await db.execute(sql`
    SELECT COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE siren_report_requested = true)::int AS "siren",
      COUNT(*) FILTER (WHERE status = 'responded')::int AS "responded",
      COUNT(*) FILTER (WHERE ai_severity IN ('critical','high'))::int AS "criticalHigh"
    FROM incident_reports
    WHERE created_at >= ${period.startDate} AND created_at <= ${period.endDate}
  `);
  const hr: any = await db.execute(sql`
    SELECT COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE siren_report_requested = true)::int AS "siren",
      COUNT(*) FILTER (WHERE status = 'responded')::int AS "responded",
      COUNT(*) FILTER (WHERE ai_severity IN ('critical','high'))::int AS "criticalHigh"
    FROM harassment_reports
    WHERE created_at >= ${period.startDate} AND created_at <= ${period.endDate}
  `);
  const lr: any = await db.execute(sql`
    SELECT COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE siren_report_requested = true)::int AS "siren",
      COUNT(*) FILTER (WHERE status IN ('matched','responded'))::int AS "matched",
      COUNT(*) FILTER (WHERE ai_urgency = 'urgent')::int AS "urgent"
    FROM legal_consultations
    WHERE created_at >= ${period.startDate} AND created_at <= ${period.endDate}
  `);
  const br: any = await db.execute(sql`
    SELECT COUNT(*)::int AS "totalPosts",
      COUNT(*) FILTER (WHERE is_pinned = true)::int AS "pinned"
    FROM board_posts
    WHERE created_at >= ${period.startDate} AND created_at <= ${period.endDate}
  `);
  const bcr: any = await db.execute(sql`
    SELECT COUNT(*)::int AS "totalComments"
    FROM board_comments
    WHERE created_at >= ${period.startDate} AND created_at <= ${period.endDate}
  `);

  const i: any = ir.rows ? ir.rows[0] : ir[0] || {};
  const h: any = hr.rows ? hr.rows[0] : hr[0] || {};
  const l: any = lr.rows ? lr.rows[0] : lr[0] || {};
  const b: any = br.rows ? br.rows[0] : br[0] || {};
  const bc: any = bcr.rows ? bcr.rows[0] : bcr[0] || {};

  return {
    incident: {
      total: Number(i.total || 0), sirenRequested: Number(i.siren || 0),
      responded: Number(i.responded || 0), criticalHigh: Number(i.criticalHigh || 0),
    },
    harassment: {
      total: Number(h.total || 0), sirenRequested: Number(h.siren || 0),
      responded: Number(h.responded || 0), criticalHigh: Number(h.criticalHigh || 0),
    },
    legal: {
      total: Number(l.total || 0), sirenRequested: Number(l.siren || 0),
      matched: Number(l.matched || 0), urgent: Number(l.urgent || 0),
    },
    board: {
      totalPosts: Number(b.totalPosts || 0),
      totalComments: Number(bc.totalComments || 0),
      pinnedCount: Number(b.pinned || 0),
    },
  };
}

/* ───────── 캠페인 통계 ───────── */
async function collectCampaignStats(period: ReportPeriod): Promise<CampaignStats> {
  const r: any = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'active')::int AS "activeCount",
      COUNT(*) FILTER (WHERE status = 'closed')::int AS "closedCount",
      COALESCE(SUM(raised_amount), 0)::bigint AS "totalRaised",
      COALESCE(SUM(donor_count), 0)::int AS "totalDonors"
    FROM campaigns
    WHERE created_at <= ${period.endDate}
      AND status IN ('active','closed')
  `);
  const s: any = r.rows ? r.rows[0] : r[0] || {};

  const topRows: any = await db.execute(sql`
    SELECT id, title, type,
      raised_amount AS "raisedAmount",
      goal_amount AS "goalAmount",
      donor_count AS "donorCount"
    FROM campaigns
    WHERE created_at <= ${period.endDate}
      AND status IN ('active','closed')
    ORDER BY raised_amount DESC
    LIMIT 5
  `);
  const tops = topRows.rows || topRows || [];

  return {
    activeCampaigns: Number(s.activeCount || 0),
    closedCampaigns: Number(s.closedCount || 0),
    totalRaised: Number(s.totalRaised || 0),
    totalDonors: Number(s.totalDonors || 0),
    topCampaigns: tops.map((c: any) => {
      const goal = c.goalAmount ? Number(c.goalAmount) : null;
      const raised = Number(c.raisedAmount || 0);
      return {
        id: c.id,
        title: c.title,
        type: c.type,
        raisedAmount: raised,
        goalAmount: goal,
        progressPercent: goal && goal > 0
          ? Math.min(100, Math.round((raised / goal) * 100 * 10) / 10) : null,
        donorCount: Number(c.donorCount || 0),
      };
    }),
  };
}

/* ───────── 메인 진입점 ───────── */
export async function collectReportData(period: ReportPeriod): Promise<ReportData> {
  const [donations, members, support, siren, campaigns] = await Promise.all([
    collectDonationStats(period),
    collectMemberStats(period),
    collectSupportStats(period),
    collectSirenStats(period),
    collectCampaignStats(period),
  ]);

  return {
    period,
    donations,
    members,
    support,
    siren,
    campaigns,
    generatedAt: new Date(),
  };
}