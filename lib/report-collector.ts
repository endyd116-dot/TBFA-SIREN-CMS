/**
 * lib/report-collector.ts — Phase 4 대표 보고 시스템 통계 수집 헬퍼
 *
 * collectReportStats(periodStart, periodEnd) 호출 시
 * members / donations / siren / expertMatches / support 5개 영역 집계.
 *
 * 각 영역 독립 try/catch — 한 영역 실패해도 나머지는 유지.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

/* ===== 타입 =====*/

export interface ReportStats {
  members: {
    newThisPeriod: number;
    withdrawnThisPeriod: number;
    totalActive: number;
    byType: { user: number; family: number; volunteer: number };
  };
  donations: {
    totalAmount: number;
    count: number;
    byType: { regular: number; onetime: number };
    regularActive: number;
    regularProspect: number;
  };
  siren: {
    incident:   { newThisPeriod: number; totalOpen: number };
    harassment: { newThisPeriod: number; totalOpen: number };
    legal:      { newThisPeriod: number; totalOpen: number };
  };
  expertMatches: {
    newThisPeriod: number;
    active: number;
    closedThisPeriod: number;
    byType: { lawyer: number; counselor: number };
  };
  support: {
    newThisPeriod: number;
    byCategory: { counseling: number; legal: number; scholarship: number };
  };
  collectedAt: string;
}

function zero(): ReportStats {
  return {
    members: { newThisPeriod: 0, withdrawnThisPeriod: 0, totalActive: 0, byType: { user: 0, family: 0, volunteer: 0 } },
    donations: { totalAmount: 0, count: 0, byType: { regular: 0, onetime: 0 }, regularActive: 0, regularProspect: 0 },
    siren: {
      incident:   { newThisPeriod: 0, totalOpen: 0 },
      harassment: { newThisPeriod: 0, totalOpen: 0 },
      legal:      { newThisPeriod: 0, totalOpen: 0 },
    },
    expertMatches: { newThisPeriod: 0, active: 0, closedThisPeriod: 0, byType: { lawyer: 0, counselor: 0 } },
    support: { newThisPeriod: 0, byCategory: { counseling: 0, legal: 0, scholarship: 0 } },
    collectedAt: new Date().toISOString(),
  };
}

function num(v: any): number {
  return parseInt(String(v ?? "0"), 10) || 0;
}

function row0(res: any): any {
  if (Array.isArray(res)) return res[0] ?? {};
  return (res as any).rows?.[0] ?? {};
}

/* ===== 수집 함수 =====*/

export async function collectReportStats(
  periodStart: Date,
  periodEnd: Date,
): Promise<ReportStats> {
  const stats = zero();
  const ps = periodStart.toISOString();
  const pe = periodEnd.toISOString();

  /* 1. 회원 현황 */
  try {
    const r = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= ${ps}::timestamptz AND created_at <= ${pe}::timestamptz AND type != 'admin') AS new_this_period,
        COUNT(*) FILTER (WHERE withdrawn_at >= ${ps}::timestamptz AND withdrawn_at <= ${pe}::timestamptz) AS withdrawn_this_period,
        COUNT(*) FILTER (WHERE status = 'active' AND type != 'admin') AS total_active,
        COUNT(*) FILTER (WHERE type = 'user'      AND status = 'active') AS type_user,
        COUNT(*) FILTER (WHERE type = 'family'    AND status = 'active') AS type_family,
        COUNT(*) FILTER (WHERE type = 'volunteer' AND status = 'active') AS type_volunteer
      FROM members
    `);
    const d = row0(r);
    stats.members = {
      newThisPeriod:       num(d.new_this_period),
      withdrawnThisPeriod: num(d.withdrawn_this_period),
      totalActive:         num(d.total_active),
      byType: {
        user:      num(d.type_user),
        family:    num(d.type_family),
        volunteer: num(d.type_volunteer),
      },
    };
  } catch (err) { console.warn("[report-collector] members 실패", err); }

  /* 2. 후원 현황 */
  try {
    const r = await db.execute(sql`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE status = 'completed' AND created_at >= ${ps}::timestamptz AND created_at <= ${pe}::timestamptz), 0) AS total_amount,
        COUNT(*)             FILTER (WHERE status = 'completed' AND created_at >= ${ps}::timestamptz AND created_at <= ${pe}::timestamptz) AS cnt,
        COUNT(*)             FILTER (WHERE status = 'completed' AND type = 'regular'  AND created_at >= ${ps}::timestamptz AND created_at <= ${pe}::timestamptz) AS regular_cnt,
        COUNT(*)             FILTER (WHERE status = 'completed' AND type = 'onetime'  AND created_at >= ${ps}::timestamptz AND created_at <= ${pe}::timestamptz) AS onetime_cnt
      FROM donations
    `);
    const d = row0(r);

    /* donor_type 현황 (전체 스냅샷, 기간 무관) */
    const dr = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE donor_type = 'regular')  AS regular_active,
        COUNT(*) FILTER (WHERE donor_type = 'prospect') AS regular_prospect
      FROM members
    `);
    const dd = row0(dr);

    stats.donations = {
      totalAmount:     num(d.total_amount),
      count:           num(d.cnt),
      byType:          { regular: num(d.regular_cnt), onetime: num(d.onetime_cnt) },
      regularActive:   num(dd.regular_active),
      regularProspect: num(dd.regular_prospect),
    };
  } catch (err) { console.warn("[report-collector] donations 실패", err); }

  /* 3. SIREN 신고 현황 */
  try {
    const openStatuses = `('submitted','ai_analyzed','reviewing','responded','matching','matched','in_progress')`;

    const ir = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= ${ps}::timestamptz AND created_at <= ${pe}::timestamptz) AS new_this_period,
        COUNT(*) FILTER (WHERE status NOT IN ('closed','rejected')) AS total_open
      FROM incident_reports
    `);
    const id = row0(ir);
    stats.siren.incident = { newThisPeriod: num(id.new_this_period), totalOpen: num(id.total_open) };

    const hr = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= ${ps}::timestamptz AND created_at <= ${pe}::timestamptz) AS new_this_period,
        COUNT(*) FILTER (WHERE status NOT IN ('closed','rejected')) AS total_open
      FROM harassment_reports
    `);
    const hd = row0(hr);
    stats.siren.harassment = { newThisPeriod: num(hd.new_this_period), totalOpen: num(hd.total_open) };

    const lr = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= ${ps}::timestamptz AND created_at <= ${pe}::timestamptz) AS new_this_period,
        COUNT(*) FILTER (WHERE status NOT IN ('closed','rejected')) AS total_open
      FROM legal_consultations
    `);
    const ld = row0(lr);
    stats.siren.legal = { newThisPeriod: num(ld.new_this_period), totalOpen: num(ld.total_open) };
  } catch (err) { console.warn("[report-collector] siren 실패", err); }

  /* 4. 전문가 매칭 현황 */
  try {
    const r = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= ${ps}::timestamptz AND created_at <= ${pe}::timestamptz) AS new_this_period,
        COUNT(*) FILTER (WHERE status IN ('matched','active','pending')) AS active_cnt,
        COUNT(*) FILTER (WHERE status = 'closed' AND updated_at >= ${ps}::timestamptz AND updated_at <= ${pe}::timestamptz) AS closed_this_period,
        COUNT(*) FILTER (WHERE match_type = 'lawyer')    AS lawyer_cnt,
        COUNT(*) FILTER (WHERE match_type = 'counselor') AS counselor_cnt
      FROM expert_matches
    `);
    const d = row0(r);
    stats.expertMatches = {
      newThisPeriod:     num(d.new_this_period),
      active:            num(d.active_cnt),
      closedThisPeriod:  num(d.closed_this_period),
      byType:            { lawyer: num(d.lawyer_cnt), counselor: num(d.counselor_cnt) },
    };
  } catch (err) { console.warn("[report-collector] expertMatches 실패", err); }

  /* 5. 유족지원 현황 */
  try {
    const r = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= ${ps}::timestamptz AND created_at <= ${pe}::timestamptz) AS new_this_period,
        COUNT(*) FILTER (WHERE category = 'counseling') AS cat_counseling,
        COUNT(*) FILTER (WHERE category = 'legal')      AS cat_legal,
        COUNT(*) FILTER (WHERE category = 'scholarship') AS cat_scholarship
      FROM support_requests
    `);
    const d = row0(r);
    stats.support = {
      newThisPeriod: num(d.new_this_period),
      byCategory: {
        counseling:  num(d.cat_counseling),
        legal:       num(d.cat_legal),
        scholarship: num(d.cat_scholarship),
      },
    };
  } catch (err) { console.warn("[report-collector] support 실패", err); }

  stats.collectedAt = new Date().toISOString();
  return stats;
}
