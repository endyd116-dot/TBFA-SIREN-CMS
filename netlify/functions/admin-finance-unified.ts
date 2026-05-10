/**
 * GET /api/admin-finance-unified
 * 재정 통합 응답: income(지출), budget(예산), report(요약)
 * super_admin: 전체 / admin: 자기 생성 데이터만
 */
import { desc, eq, sum, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  expenditures,
  budgets,
  budgetCategories,
} from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin-finance-unified" };

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "재정 통합 조회 실패",
      step,
      detail: String(err?.message ?? err).slice(0, 500),
      stack: String(err?.stack ?? "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const isSuperAdmin = auth.ctx.member.role === "super_admin";
  const adminId = auth.ctx.admin.uid;

  // 예산 카테고리 (보조 데이터 — 실패 시 빈 배열)
  let categoryMap: Map<number, string> = new Map();
  try {
    const cats = await db
      .select({ id: budgetCategories.id, name: budgetCategories.name })
      .from(budgetCategories);
    for (const c of cats) categoryMap.set(c.id, c.name);
  } catch (err: any) {
    console.warn("[admin-finance-unified] budgetCategories select 실패:", err);
  }

  let step = "select_income";
  let incomeRows: any[] = [];
  try {
    const rows = isSuperAdmin
      ? await db
          .select({
            id: expenditures.id,
            categoryId: expenditures.categoryId,
            amount: expenditures.amount,
            spentAt: expenditures.spentAt,
            description: expenditures.description,
            payee: expenditures.payee,
            status: expenditures.status,
            createdBy: expenditures.createdBy,
            approvedBy: expenditures.approvedBy,
            approvedAt: expenditures.approvedAt,
            createdAt: expenditures.createdAt,
          })
          .from(expenditures)
          .orderBy(desc(expenditures.createdAt))
          .limit(500)
      : await db
          .select({
            id: expenditures.id,
            categoryId: expenditures.categoryId,
            amount: expenditures.amount,
            spentAt: expenditures.spentAt,
            description: expenditures.description,
            payee: expenditures.payee,
            status: expenditures.status,
            createdBy: expenditures.createdBy,
            approvedBy: expenditures.approvedBy,
            approvedAt: expenditures.approvedAt,
            createdAt: expenditures.createdAt,
          })
          .from(expenditures)
          .where(eq(expenditures.createdBy, adminId))
          .orderBy(desc(expenditures.createdAt))
          .limit(500);

    incomeRows = rows.map((r) => ({
      ...r,
      categoryName: categoryMap.get(r.categoryId ?? 0) ?? null,
    }));
  } catch (err: any) {
    return jsonError(step, err);
  }

  step = "select_budget";
  let budgetRows: any[] = [];
  try {
    const rows = isSuperAdmin
      ? await db
          .select({
            id: budgets.id,
            fiscalYear: budgets.fiscalYear,
            categoryId: budgets.categoryId,
            plannedAmount: budgets.plannedAmount,
            note: budgets.note,
            createdBy: budgets.createdBy,
            createdAt: budgets.createdAt,
          })
          .from(budgets)
          .orderBy(desc(budgets.createdAt))
          .limit(200)
      : await db
          .select({
            id: budgets.id,
            fiscalYear: budgets.fiscalYear,
            categoryId: budgets.categoryId,
            plannedAmount: budgets.plannedAmount,
            note: budgets.note,
            createdBy: budgets.createdBy,
            createdAt: budgets.createdAt,
          })
          .from(budgets)
          .where(eq(budgets.createdBy, adminId))
          .orderBy(desc(budgets.createdAt))
          .limit(200);

    budgetRows = rows.map((r) => ({
      ...r,
      categoryName: categoryMap.get(r.categoryId ?? 0) ?? null,
    }));
  } catch (err: any) {
    console.warn("[admin-finance-unified] budget select 실패:", err);
    budgetRows = [];
  }

  step = "build_report";
  let report: any = null;
  try {
    const totalBudget = budgetRows.reduce(
      (acc, r) => acc + Number(r.plannedAmount ?? 0),
      0
    );
    const totalSpent = incomeRows
      .filter((r) => r.status === "approved")
      .reduce((acc, r) => acc + Number(r.amount ?? 0), 0);

    const byCategory: Record<string, { planned: number; spent: number }> = {};
    for (const b of budgetRows) {
      const key = b.categoryName ?? `cat-${b.categoryId}`;
      if (!byCategory[key]) byCategory[key] = { planned: 0, spent: 0 };
      byCategory[key].planned += Number(b.plannedAmount ?? 0);
    }
    for (const e of incomeRows.filter((r) => r.status === "approved")) {
      const key = e.categoryName ?? `cat-${e.categoryId}`;
      if (!byCategory[key]) byCategory[key] = { planned: 0, spent: 0 };
      byCategory[key].spent += Number(e.amount ?? 0);
    }

    report = {
      totalBudget,
      totalSpent,
      remaining: totalBudget - totalSpent,
      utilizationRate:
        totalBudget > 0
          ? Math.round((totalSpent / totalBudget) * 10000) / 100
          : 0,
      byCategory,
    };
  } catch (err: any) {
    console.warn("[admin-finance-unified] report build 실패:", err);
    report = null;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      income: incomeRows,
      budget: budgetRows,
      report,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
