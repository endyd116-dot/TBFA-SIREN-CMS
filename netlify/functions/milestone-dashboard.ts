import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/milestone-dashboard" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  const member = auth.ctx.member as any;

  const url = new URL(req.url);
  const quarterIdParam = url.searchParams.get("quarterId");

  function jsonError(step: string, err: any) {
    return Response.json({
      ok: false, error: "대시보드 조회 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, { status: 500 });
  }

  let quarter: any;
  try {
    if (quarterIdParam) {
      const rows = await db.execute(sql`
        SELECT * FROM quarters WHERE id = ${Number(quarterIdParam)}
      `);
      quarter = (rows as any).rows?.[0] || rows[0];
    } else {
      const rows = await db.execute(sql`
        SELECT * FROM quarters WHERE status = 'ACTIVE' ORDER BY year DESC, quarter DESC LIMIT 1
      `);
      quarter = (rows as any).rows?.[0] || rows[0];
    }
    if (!quarter) {
      return Response.json({ ok: true, data: { quarter: null, milestoneRole: member.milestoneRole || null,
        revenueProgress: [], nonRevenueAchievements: [], settlement: null,
        estimatedIncentive: { revenueLinked: 0, nonRevenue: 0, total: 0 } } });
    }
  } catch (err) { return jsonError("select_quarter", err); }

  const milestoneRole = member.milestoneRole || null;

  let milestones: any[] = [];
  try {
    if (milestoneRole) {
      const rows = await db.execute(sql`
        SELECT * FROM milestone_definitions
        WHERE target_milestone_role = ${milestoneRole} AND is_active = TRUE
        ORDER BY sort_order
      `);
      milestones = (rows as any).rows || (rows as any[]);
    }
  } catch (err) { return jsonError("select_milestones", err); }

  // 매출연동 마일스톤 진행률 계산
  const revenueProgress: any[] = [];
  let revenueLinkedTotal = 0;
  try {
    const revMilestones = milestones.filter((m: any) => m.category === "REVENUE_LINKED");

    // SI 공유 임계점 그룹 처리를 위해 그룹별 합계 미리 계산
    const sharedGroups: Record<string, { total: number; items: any[] }> = {};
    for (const m of revMilestones) {
      if (m.is_shared_threshold && m.shared_threshold_group) {
        if (!sharedGroups[m.shared_threshold_group]) {
          sharedGroups[m.shared_threshold_group] = { total: 0, items: [] };
        }
        const rows = await db.execute(sql`
          SELECT COALESCE(SUM(amount), 0) as total FROM revenue_entries
          WHERE milestone_definition_id = ${m.id}
            AND quarter_id = ${quarter.id}
            AND status = 'VERIFIED'
        `);
        const amt = Number(((rows as any).rows?.[0] || rows[0])?.total || 0);
        sharedGroups[m.shared_threshold_group].total += amt;
        sharedGroups[m.shared_threshold_group].items.push({ milestone: m, amount: amt });
      }
    }

    for (const m of revMilestones) {
      let currentAmt = 0;
      if (m.is_shared_threshold && m.shared_threshold_group) {
        const grpItem = sharedGroups[m.shared_threshold_group]?.items.find((i: any) => i.milestone.id === m.id);
        currentAmt = grpItem?.amount || 0;
      } else {
        const rows = await db.execute(sql`
          SELECT COALESCE(SUM(amount), 0) as total FROM revenue_entries
          WHERE milestone_definition_id = ${m.id}
            AND quarter_id = ${quarter.id}
            AND status = 'VERIFIED'
        `);
        currentAmt = Number(((rows as any).rows?.[0] || rows[0])?.total || 0);
      }

      let incentive = 0;
      let thresholdStatus = "N/A";

      if (m.is_shared_threshold && m.shared_threshold_group) {
        // SI 공유 임계점 처리 (그룹 첫 번째 항목에서만 전체 계산, 나머지는 0)
        const grp = sharedGroups[m.shared_threshold_group];
        if (grp && grp.items[0]?.milestone.id === m.id) {
          incentive = calcSISharedBonus(grp.items);
          revenueLinkedTotal += incentive;
        }
        thresholdStatus = grp.total >= Number(m.threshold_value || 0) ? "ABOVE" : "BELOW";
      } else {
        const formula = m.bonus_formula as any;
        incentive = calcIncentive(formula, Number(m.threshold_enabled), Number(m.threshold_value || 0), currentAmt);
        revenueLinkedTotal += incentive;
        if (m.threshold_enabled) {
          thresholdStatus = currentAmt > Number(m.threshold_value || 0) ? "ABOVE" : "BELOW";
        }
      }

      const thrVal = Number(m.threshold_value || 0);
      const progressPct = thrVal > 0 ? Math.min(Math.round((currentAmt / thrVal) * 100), 999) : (currentAmt > 0 ? 100 : 0);

      revenueProgress.push({
        milestoneId: m.id, code: m.code, name: m.name,
        category: m.category, businessUnit: m.business_unit,
        thresholdEnabled: m.threshold_enabled, thresholdValue: String(m.threshold_value || ""),
        thresholdUnit: m.threshold_unit,
        currentVerifiedAmount: String(currentAmt),
        progressPct, estimatedIncentive: incentive, thresholdStatus,
        isShared: m.is_shared_threshold, sharedGroup: m.shared_threshold_group,
      });
    }
  } catch (err) { return jsonError("calc_revenue", err); }

  // 비매출 성과
  let nonRevenueAchievements: any[] = [];
  let nonRevenueTotal = 0;
  try {
    const rows = await db.execute(sql`
      SELECT nra.*, md.code as milestone_code, md.name as milestone_name
      FROM non_revenue_achievements nra
      JOIN milestone_definitions md ON md.id = nra.milestone_definition_id
      WHERE nra.submitted_by = ${member.id} AND nra.quarter_id = ${quarter.id}
      ORDER BY nra.created_at DESC
    `);
    nonRevenueAchievements = ((rows as any).rows || (rows as any[])).map((r: any) => ({
      id: r.id,
      milestoneCode: r.milestone_code,
      name: r.milestone_name,
      achievedDate: r.achieved_date,
      bonusAmount: r.event_range_amount ? String(r.event_range_amount) : String(r.bonus_amount),
      status: r.status,
      isSelectedForQuarter: r.is_selected_for_quarter,
      selectionOrder: r.selection_order,
      description: r.description,
    }));
    nonRevenueTotal = nonRevenueAchievements
      .filter((a: any) => a.status === "VERIFIED" && a.isSelectedForQuarter)
      .reduce((s: number, a: any) => s + Number(a.bonusAmount), 0);
  } catch (err) { /* non-critical */ }

  // 분기 결산
  let settlement: any = null;
  try {
    const rows = await db.execute(sql`
      SELECT * FROM quarterly_settlements
      WHERE member_id = ${member.id} AND quarter_id = ${quarter.id}
      LIMIT 1
    `);
    const row = (rows as any).rows?.[0] || rows[0];
    if (row) {
      settlement = {
        id: row.id, status: row.status,
        revenueLinkedTotal: row.revenue_linked_total,
        nonRevenueTotal: row.non_revenue_total,
        totalBonus: row.total_bonus,
        submittedAt: row.submitted_at,
        approvedAt: row.approved_at,
      };
    }
  } catch (err) { /* non-critical */ }

  return Response.json({
    ok: true,
    data: {
      quarter: {
        id: quarter.id, year: quarter.year, quarter: quarter.quarter,
        startDate: quarter.start_date, endDate: quarter.end_date, status: quarter.status,
      },
      milestoneRole,
      revenueProgress,
      nonRevenueAchievements,
      settlement,
      estimatedIncentive: {
        revenueLinked: revenueLinkedTotal,
        nonRevenue: nonRevenueTotal,
        total: revenueLinkedTotal + nonRevenueTotal,
      },
      /* ★ R29-MS-GAP2-E: 인센티브 계산 breakdown 상세 */
      breakdown: {
        revenue: revenueProgress.map((p: any) => ({
          milestoneName: p.name,
          milestoneCode: p.code,
          currentAmount: Number(p.currentVerifiedAmount || 0),
          thresholdValue: Number(p.thresholdValue || 0),
          subtotal: Number(p.estimatedIncentive || 0),
        })).filter((r: any) => r.subtotal > 0 || r.currentAmount > 0),
        nonRevenue: nonRevenueAchievements
          .filter((a: any) => a.status === "VERIFIED" && a.isSelectedForQuarter)
          .map((a: any) => ({
            milestoneName: a.name,
            milestoneCode: a.milestoneCode,
            bonus: Number(a.bonusAmount || 0),
          })),
      },
    },
  });
}

function calcIncentive(formula: any, thresholdEnabled: number, thrVal: number, current: number): number {
  if (!formula) return 0;
  let base = current;
  if (thresholdEnabled) {
    const excess = current - thrVal;
    if (excess <= 0) return 0;
    base = excess;
  }
  switch (formula.type) {
    case "FLAT":    return Math.floor(base) * (formula.unitAmount || 0);
    case "PERCENT": return Math.round(base * (formula.rate || 0));
    case "BRACKET": {
      const brackets: Array<{min:number;max:number|null;amount:number}> = formula.brackets || [];
      const matched = brackets.sort((a, b) => b.min - a.min).find(b => current >= b.min && (b.max == null || current <= b.max));
      return matched ? matched.amount : 0;
    }
    case "EVENT_RANGE": return 0; // 수동 결정
    default: return 0;
  }
}

function calcSISharedBonus(items: Array<{milestone: any; amount: number}>): number {
  const total = items.reduce((s, i) => s + i.amount, 0);
  const thrVal = Number(items[0]?.milestone.threshold_value || 30_000_000);
  const excess = total - thrVal;
  if (excess <= 0) return 0;
  let bonus = 0;
  for (const { milestone: m, amount } of items) {
    const channelExcess = excess * (amount / total);
    const rate = (m.bonus_formula as any)?.rate || 0.05;
    bonus += channelExcess * rate;
  }
  return Math.round(bonus);
}
