import { yearKST, isoUTC, jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { buildBudgetReport } from "../../lib/finance-budget-report";

export const config = { path: "/api/admin-finance-budget-list" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "예산 집행률 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") || String(yearKST()));

  // 1. 해당 연도의 approved 예산안 조회
  let plan: any = null;
  try {
    const planRows: any = await db.execute(sql`
      SELECT id, fiscal_year, title, status, total_planned, approved_at
      FROM budget_plans
      WHERE fiscal_year = ${year} AND status = 'approved'
      LIMIT 1
    `);
    plan = (planRows?.rows ?? planRows ?? [])[0] ?? null;
  } catch (err: any) {
    return jsonError("select_plan", err);
  }

  // 승인된 예산안 없을 때
  if (!plan) {
    // 다른 상태 예산안 존재 여부 확인
    let planStatus: string | null = null;
    let allPlans: any[] = [];
    try {
      const allRows: any = await db.execute(sql`
        SELECT id, fiscal_year, title, status FROM budget_plans WHERE fiscal_year = ${year} LIMIT 1
      `);
      const arr = allRows?.rows ?? allRows ?? [];
      if (arr[0]) planStatus = arr[0].status;

      const allYears: any = await db.execute(sql`
        SELECT id, fiscal_year, title, status FROM budget_plans ORDER BY fiscal_year DESC LIMIT 10
      `);
      allPlans = (allYears?.rows ?? allYears ?? []).map((r: any) => ({
        id: Number(r.id), fiscalYear: Number(r.fiscal_year), title: r.title, status: r.status,
      }));
    } catch { /* 보조 조회 실패는 무시 */ }

    return new Response(jsonKST({
      ok: true,
      data: {
        year,
        noPlan: true,
        planStatus,
        allPlans,
        items: [],
        totalPlanned: 0,
        totalExecuted: 0,
        message: `${year}년도 승인된 예산안이 없습니다. 예산안을 편성·승인 후 집행률 확인이 가능합니다.`,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // 2. 편성 항목·집행·예약 집계 (관·항·목 + 옛 분류, 화면·PDF 공용)
  let report: Awaited<ReturnType<typeof buildBudgetReport>>;
  try {
    report = await buildBudgetReport(Number(plan.id), year);
  } catch (err: any) {
    return jsonError("build_report", err);
  }
  const { items, totalPlanned, totalExecuted, totalReserved } = report;

  return new Response(jsonKST({
    ok: true,
    data: {
      year,
      noPlan: false,
      planStatus: plan.status,
      plan: {
        id:           Number(plan.id),
        title:        plan.title,
        totalPlanned: Number(plan.total_planned),
        approvedAt:   isoUTC(plan.approved_at),
      },
      items,
      totalPlanned,
      totalExecuted,
      totalRemaining: report.totalRemaining,
      executionRate: report.executionRate,
      // Phase 22-D-R3 예산 잠금
      totalReserved,
      totalAvailable: report.totalAvailable,
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}
