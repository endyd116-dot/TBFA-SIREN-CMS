import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { notifyAllSuperAdmins } from "../../lib/notify";

export const config = { path: "/api/milestone-settlement" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  const admin = auth.ctx?.member as any;

  function jsonError(step: string, err: any) {
    return Response.json({ ok: false, error: "결산 오류", step,
      detail: String(err?.message || err).slice(0, 500) }, { status: 500 });
  }

  const url = new URL(req.url);
  const action = url.pathname.split("/").pop();

  // ── GET 내 결산 ──
  if (req.method === "GET") {
    const quarterId = url.searchParams.get("quarterId");
    try {
      let q = `SELECT qs.*, q.year, q.quarter, q.status as quarter_status
               FROM quarterly_settlements qs
               JOIN quarters q ON q.id = qs.quarter_id
               WHERE qs.member_id = $1`;
      const params: any[] = [admin.id];
      if (quarterId) { params.push(Number(quarterId)); q += ` AND qs.quarter_id = $${params.length}`; }
      q += ` ORDER BY q.year DESC, q.quarter DESC LIMIT 10`;
      const rows = await db.execute(sql.raw(q, params));
      const settlements = ((rows as any).rows || (rows as any[])).map(formatSettle);
      return Response.json({ ok: true, data: { settlements } });
    } catch (err) { return jsonError("select", err); }
  }

  // ── POST /calculate — 자동 계산 ──
  if (req.method === "POST" && action === "calculate") {
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { quarterId } = body;
    if (!quarterId) return Response.json({ ok: false, error: "quarterId 필수" }, { status: 400 });
    try {
      const result = await calcSettlement(admin.id, Number(quarterId));
      return Response.json({ ok: true, data: result });
    } catch (err) { return jsonError("calculate", err); }
  }

  // ── POST /submit — 결산 제출 ──
  if (req.method === "POST" && action === "submit") {
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { quarterId, selfEvaluation } = body;
    if (!quarterId) return Response.json({ ok: false, error: "quarterId 필수" }, { status: 400 });
    try {
      const calc = await calcSettlement(admin.id, Number(quarterId));

      // UPSERT quarterly_settlements
      const existing = await db.execute(sql`
        SELECT id, status FROM quarterly_settlements
        WHERE member_id = ${admin.id} AND quarter_id = ${Number(quarterId)}
      `);
      const ex = (existing as any).rows?.[0] || existing[0];

      if (ex && !["DRAFT", "REJECTED"].includes(ex.status)) {
        return Response.json({ ok: false, error: `현재 상태(${ex.status})에서는 재제출 불가입니다` }, { status: 400 });
      }

      const snapshot = JSON.stringify(calc);
      if (ex) {
        await db.execute(sql`
          UPDATE quarterly_settlements SET
            revenue_linked_total = ${String(calc.revenueLinkedTotal)},
            non_revenue_total = ${String(calc.nonRevenueTotal)},
            total_bonus = ${String(calc.totalBonus)},
            calculation_snapshot = ${snapshot}::jsonb,
            self_evaluation = ${selfEvaluation ?? null},
            status = 'SUBMITTED', submitted_at = NOW(), updated_at = NOW()
          WHERE id = ${ex.id}
        `);
      } else {
        await db.execute(sql`
          INSERT INTO quarterly_settlements
            (quarter_id, member_id, revenue_linked_total, non_revenue_total, total_bonus,
             calculation_snapshot, self_evaluation, status, submitted_at)
          VALUES (
            ${Number(quarterId)}, ${admin.id},
            ${String(calc.revenueLinkedTotal)}, ${String(calc.nonRevenueTotal)}, ${String(calc.totalBonus)},
            ${snapshot}::jsonb, ${selfEvaluation ?? null}, 'SUBMITTED', NOW()
          )
        `);
      }
      // 슈퍼어드민 전체에게 결산 제출 알림 (fire-and-forget)
      notifyAllSuperAdmins({
        category: "milestone", severity: "info",
        title: `분기 결산 제출: ${admin.name || admin.email}`,
        message: `총 변동급 ${calc.totalBonus.toLocaleString()}원 결산이 제출되었습니다.`,
        link: "/admin#settlement-review",
      }).catch(() => {});

      return Response.json({ ok: true, data: calc });
    } catch (err) { return jsonError("submit", err); }
  }

  return Response.json({ ok: false, error: "지원하지 않는 메서드 또는 경로" }, { status: 405 });
}

async function calcSettlement(memberId: number, quarterId: number) {
  // 멤버 milestoneRole 조회
  const mRows = await db.execute(sql`SELECT milestone_role FROM members WHERE id = ${memberId}`);
  const milestoneRole = ((mRows as any).rows?.[0] || mRows[0])?.milestone_role;

  // 담당 마일스톤 조회
  const mdRows = await db.execute(sql`
    SELECT * FROM milestone_definitions
    WHERE target_milestone_role = ${milestoneRole} AND is_active = TRUE ORDER BY sort_order
  `);
  const milestones = (mdRows as any).rows || (mdRows as any[]);

  let revenueLinkedTotal = 0;
  const revenueBreakdown: any[] = [];

  // SI 공유 임계점 처리
  const sharedGroups: Record<string, { total: number; items: Array<{milestone:any;amount:number}> }> = {};
  for (const m of milestones.filter((m: any) => m.category === "REVENUE_LINKED" && m.is_shared_threshold)) {
    if (!sharedGroups[m.shared_threshold_group]) sharedGroups[m.shared_threshold_group] = { total: 0, items: [] };
    const r = await db.execute(sql`
      SELECT COALESCE(SUM(amount),0) as total FROM revenue_entries
      WHERE milestone_definition_id = ${m.id} AND quarter_id = ${quarterId} AND status = 'VERIFIED'
    `);
    const amt = Number(((r as any).rows?.[0] || r[0])?.total || 0);
    sharedGroups[m.shared_threshold_group].total += amt;
    sharedGroups[m.shared_threshold_group].items.push({ milestone: m, amount: amt });
  }

  for (const m of milestones.filter((m: any) => m.category === "REVENUE_LINKED")) {
    let incentive = 0;
    let verifiedAmount = 0;

    if (m.is_shared_threshold && m.shared_threshold_group) {
      const grp = sharedGroups[m.shared_threshold_group];
      const grpItem = grp?.items.find((i: any) => i.milestone.id === m.id);
      verifiedAmount = grpItem?.amount || 0;
      if (grp?.items[0]?.milestone.id === m.id) {
        incentive = calcSISharedBonus(grp.items);
        revenueLinkedTotal += incentive;
      }
    } else {
      const r = await db.execute(sql`
        SELECT COALESCE(SUM(amount),0) as total FROM revenue_entries
        WHERE milestone_definition_id = ${m.id} AND quarter_id = ${quarterId} AND status = 'VERIFIED'
      `);
      verifiedAmount = Number(((r as any).rows?.[0] || r[0])?.total || 0);
      incentive = applyFormula(m.bonus_formula, m.threshold_enabled, Number(m.threshold_value || 0), verifiedAmount);
      revenueLinkedTotal += incentive;
    }

    revenueBreakdown.push({ code: m.code, name: m.name, verifiedAmount, incentive });
  }

  // 비매출 보너스 (선택된 2개)
  const nrRows = await db.execute(sql`
    SELECT nra.*, md.code FROM non_revenue_achievements nra
    JOIN milestone_definitions md ON md.id = nra.milestone_definition_id
    WHERE nra.submitted_by = ${memberId} AND nra.quarter_id = ${quarterId}
      AND nra.status = 'VERIFIED' AND nra.is_selected_for_quarter = TRUE
    ORDER BY nra.selection_order
  `);
  const selected = (nrRows as any).rows || (nrRows as any[]);
  if (selected.length > 2) throw new Error("비매출 선택 항목이 2개를 초과합니다");

  let nonRevenueTotal = 0;
  const nonRevenueBreakdown: any[] = [];
  for (const r of selected) {
    const bonus = Number(r.event_range_amount || r.bonus_amount || 0);
    nonRevenueTotal += bonus;
    nonRevenueBreakdown.push({ code: r.code, name: r.milestone_name, bonus, selectionOrder: r.selection_order });
  }

  return {
    memberId, quarterId, milestoneRole,
    revenueLinkedTotal, nonRevenueTotal, totalBonus: revenueLinkedTotal + nonRevenueTotal,
    revenueBreakdown, nonRevenueBreakdown,
  };
}

function applyFormula(formula: any, thresholdEnabled: boolean, thrVal: number, current: number): number {
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
      const matched = brackets.sort((a, b) => b.min - a.min)
        .find(b => current >= b.min && (b.max == null || current <= b.max));
      return matched ? matched.amount : 0;
    }
    default: return 0;
  }
}

function calcSISharedBonus(items: Array<{milestone:any;amount:number}>): number {
  const total = items.reduce((s, i) => s + i.amount, 0);
  const thrVal = Number(items[0]?.milestone.threshold_value || 30_000_000);
  const excess = total - thrVal;
  if (excess <= 0) return 0;
  let bonus = 0;
  for (const { milestone: m, amount } of items) {
    const channelExcess = excess * (amount / total);
    bonus += channelExcess * ((m.bonus_formula as any)?.rate || 0.05);
  }
  return Math.round(bonus);
}

function formatSettle(r: any) {
  return {
    id: r.id, quarterId: r.quarter_id, memberId: r.member_id,
    year: r.year, quarter: r.quarter, quarterStatus: r.quarter_status,
    revenueLinkedTotal: r.revenue_linked_total,
    nonRevenueTotal: r.non_revenue_total, totalBonus: r.total_bonus,
    calculationSnapshot: r.calculation_snapshot,
    selfEvaluation: r.self_evaluation, status: r.status,
    submittedAt: r.submitted_at, approvedAt: r.approved_at, paidAt: r.paid_at,
  };
}
