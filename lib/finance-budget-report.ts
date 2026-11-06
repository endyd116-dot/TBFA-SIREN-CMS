// lib/finance-budget-report.ts — 예산 대비 실적·지출 항목 표시의 단일 출처 (2026-11-06)
//
// 배경: 예산은 관·항·목(budget_accounts)으로 바뀌었는데 재무 보고서는 옛 분류(expense_categories)로
//       조인해서, 목 단위로 편성한 예산이 표에서 통째로 빠지고 결재 지출은 «기타»로 묶였다.
// 원칙: 화면(admin-finance-budget-list)과 PDF(admin-finance-report-pdf)가 같은 계산을 쓴다.
//       옛 분류로 편성한 과거 예산도 그대로 읽는다.
//       어느 예산 항목에도 물리지 않는 지출은 «예산 미배정 지출» 행으로 보여 합계가 항상 맞게 한다.
import { sql } from "drizzle-orm";
import { db } from "../db";

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];

export interface BudgetLineView {
  id: number;
  categoryId: number | null;
  budgetAccountId: number | null;
  categoryCode: string | null;
  categoryName: string;
  /** 관 › 항 경로. 옛 분류 라인은 빈 문자열 */
  path: string;
  plannedAmount: number;
  prevYearActual: number;
  note: string | null;
}

/** 예산안의 편성 항목. 목 단위 라인과 옛 분류 라인을 함께 읽는다. */
export async function loadBudgetLineViews(planId: number): Promise<BudgetLineView[]> {
  const res: any = await db.execute(sql`
    SELECT bl.id, bl.category_id, bl.budget_account_id, bl.planned_amount, bl.prev_year_actual, bl.note,
           mok.code AS mok_code, mok.name AS mok_name,
           hang.name AS hang_name, gwan.name AS gwan_name,
           ec.code AS category_code, ec.name AS category_name
    FROM budget_lines bl
    LEFT JOIN budget_accounts mok  ON mok.id  = bl.budget_account_id
    LEFT JOIN budget_accounts hang ON hang.id = mok.parent_id
    LEFT JOIN budget_accounts gwan ON gwan.id = hang.parent_id
    LEFT JOIN expense_categories ec ON ec.id = bl.category_id
    WHERE bl.plan_id = ${planId}
    ORDER BY gwan.sort_order NULLS LAST, gwan.code, hang.sort_order, hang.code,
             mok.sort_order, mok.code, ec.sort_order NULLS LAST, bl.id
  `);
  return rowsOf(res).map((r: any) => ({
    id: Number(r.id),
    categoryId: r.category_id == null ? null : Number(r.category_id),
    budgetAccountId: r.budget_account_id == null ? null : Number(r.budget_account_id),
    categoryCode: r.mok_code ?? r.category_code ?? null,
    categoryName: r.mok_name ?? r.category_name ?? "미분류",
    path: [r.gwan_name, r.hang_name].filter(Boolean).join(" › "),
    plannedAmount: Number(r.planned_amount) || 0,
    prevYearActual: Number(r.prev_year_actual) || 0,
    note: r.note ?? null,
  }));
}

export interface BudgetReportItem {
  id: number | null;
  categoryId: number | null;
  budgetAccountId: number | null;
  categoryCode: string | null;
  categoryName: string;
  path: string;
  plannedAmount: number;
  executedAmount: number;
  remaining: number;
  rate: number;
  prevYearActual: number;
  note: string | null;
  reserved: number;
  available: number;
  overBudget: boolean;
}

export interface BudgetReport {
  items: BudgetReportItem[];
  totalPlanned: number;
  totalExecuted: number;
  totalRemaining: number;
  executionRate: number;
  totalReserved: number;
  totalAvailable: number;
}

/** 승인된 예산안 1건의 예산 대비 실적. 집행 기준은 승인된 지출(expenses)이다. */
export async function buildBudgetReport(planId: number, year: number): Promise<BudgetReport> {
  const lines = await loadBudgetLineViews(planId);

  const lineByAccount = new Map<number, BudgetLineView>();
  const lineByCategory = new Map<number, BudgetLineView>();
  for (const l of lines) {
    if (l.budgetAccountId != null) lineByAccount.set(l.budgetAccountId, l);
    else if (l.categoryId != null) lineByCategory.set(l.categoryId, l);
  }

  // 집행: 목에 물린 지출은 목 라인으로, 옛 분류만 있는 지출은 옛 분류 라인으로 배정
  const executedByLine = new Map<number, number>();
  let unassigned = 0;
  try {
    const res: any = await db.execute(sql`
      SELECT budget_account_id, category_id,
             COALESCE(SUM(amount - refund_amount), 0)::bigint AS executed
      FROM expenses
      WHERE fiscal_year = ${year} AND status = 'approved'
      GROUP BY budget_account_id, category_id
    `);
    for (const r of rowsOf(res)) {
      const amount = Number(r.executed) || 0;
      const accountId = r.budget_account_id == null ? null : Number(r.budget_account_id);
      const categoryId = r.category_id == null ? null : Number(r.category_id);
      const line = (accountId != null ? lineByAccount.get(accountId) : undefined)
        ?? (categoryId != null ? lineByCategory.get(categoryId) : undefined);
      if (line) executedByLine.set(line.id, (executedByLine.get(line.id) ?? 0) + amount);
      else unassigned += amount;
    }
  } catch (err: any) {
    console.warn("[budget-report] 지출 집계 실패 (0으로 계속):", err?.message);
  }

  // 예약: 제출된 전표 합. 보조 집계라 실패해도 0으로 계속
  const reservedByLine = new Map<number, number>();
  try {
    const res: any = await db.execute(sql`
      SELECT budget_line_id, COALESCE(SUM(amount), 0)::bigint AS reserved
      FROM vouchers
      WHERE budget_line_id IS NOT NULL AND fiscal_year = ${year}
        AND is_template = FALSE AND status = 'submitted'
      GROUP BY budget_line_id
    `);
    for (const r of rowsOf(res)) reservedByLine.set(Number(r.budget_line_id), Number(r.reserved) || 0);
  } catch (err: any) {
    console.warn("[budget-report] 전표 예약액 집계 실패 (0으로 계속):", err?.message);
  }

  const items: BudgetReportItem[] = lines.map((l) => {
    const executed = executedByLine.get(l.id) ?? 0;
    const reserved = reservedByLine.get(l.id) ?? 0;
    const available = l.plannedAmount - reserved - executed;
    return {
      id: l.id,
      categoryId: l.categoryId,
      budgetAccountId: l.budgetAccountId,
      categoryCode: l.categoryCode,
      categoryName: l.categoryName,
      path: l.path,
      plannedAmount: l.plannedAmount,
      executedAmount: executed,
      remaining: l.plannedAmount - executed,
      rate: l.plannedAmount > 0 ? Math.round((executed / l.plannedAmount) * 100) : 0,
      prevYearActual: l.prevYearActual,
      note: l.note,
      reserved,
      available,
      overBudget: available < 0,
    };
  });

  if (unassigned !== 0) {
    items.push({
      id: null, categoryId: null, budgetAccountId: null,
      categoryCode: null, categoryName: "예산 미배정 지출", path: "",
      plannedAmount: 0, executedAmount: unassigned, remaining: -unassigned, rate: 0,
      prevYearActual: 0, note: null, reserved: 0, available: -unassigned, overBudget: false,
    });
  }

  const totalPlanned = items.reduce((s, i) => s + i.plannedAmount, 0);
  const totalExecuted = items.reduce((s, i) => s + i.executedAmount, 0);
  const totalReserved = items.reduce((s, i) => s + i.reserved, 0);
  return {
    items, totalPlanned, totalExecuted,
    totalRemaining: totalPlanned - totalExecuted,
    executionRate: totalPlanned > 0 ? Math.round((totalExecuted / totalPlanned) * 100) : 0,
    totalReserved,
    totalAvailable: totalPlanned - totalReserved - totalExecuted,
  };
}

/* ── 지출 항목 표시 ──
   결재로 만든 지출은 옛 분류 없이 예산 목만 갖는다. 옛 분류가 있으면 그대로 쓰고, 없으면 목 이름을 쓴다. */
export interface ExpenseLabelMaps {
  categories: Map<number, { code: string; name: string }>;
  accounts: Map<number, { code: string; name: string }>;
}

export async function loadExpenseLabelMaps(): Promise<ExpenseLabelMaps> {
  const categories = new Map<number, { code: string; name: string }>();
  const accounts = new Map<number, { code: string; name: string }>();
  try {
    const res: any = await db.execute(sql`SELECT id, code, name FROM expense_categories`);
    for (const r of rowsOf(res)) categories.set(Number(r.id), { code: r.code, name: r.name });
  } catch (err: any) { console.warn("[budget-report] 지출 분류 조회 실패", err?.message); }
  try {
    const res: any = await db.execute(sql`SELECT id, code, name FROM budget_accounts`);
    for (const r of rowsOf(res)) accounts.set(Number(r.id), { code: r.code, name: r.name });
  } catch (err: any) { console.warn("[budget-report] 예산 과목 조회 실패", err?.message); }
  return { categories, accounts };
}

export function expenseLabel(
  maps: ExpenseLabelMaps,
  categoryId: number | null | undefined,
  budgetAccountId: number | null | undefined,
): { key: string; code: string; name: string } {
  if (categoryId != null) {
    const c = maps.categories.get(Number(categoryId));
    return { key: `c${categoryId}`, code: c?.code ?? String(categoryId), name: c?.name ?? "기타" };
  }
  if (budgetAccountId != null) {
    const a = maps.accounts.get(Number(budgetAccountId));
    return { key: `b${budgetAccountId}`, code: a?.code ?? String(budgetAccountId), name: a?.name ?? "기타" };
  }
  return { key: "none", code: "unclassified", name: "미분류" };
}
