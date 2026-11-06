import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { loadBudgetLineViews } from "../../lib/finance-budget-report";

export const config = { path: "/api/admin-budget-lines-list" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "예산 항목 목록 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

/**
 * GET /api/admin-budget-lines-list?year=YYYY[&accountCode=XXX]
 * 해당 회계연도의 '승인된' 예산안 편성 항목 목록.
 * accountCode 전달 시 — 그 계정과목의 분류와 일치하는 예산 항목을
 * AI 1차 추천(suggestedLineId)으로 함께 반환. (계정과목은 이미 AI가 분류한 값)
 */
export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") || "0", 10);
  const accountCode = (url.searchParams.get("accountCode") || "").trim();
  if (!year || year < 2000 || year > 2999) {
    return new Response(jsonKST({ ok: false, error: "유효한 year 파라미터가 필요합니다." }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // ── 승인된 예산안 1건 ────────────────────────────────────
  let plan: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, fiscal_year, title, status
      FROM budget_plans
      WHERE fiscal_year = ${year} AND status = 'approved'
      LIMIT 1`);
    plan = (r?.rows ?? r ?? [])[0] || null;
  } catch (err) {
    return jsonError("select_plan", err);
  }

  // 승인된 예산안 없음 — 빈 목록으로 정상 반환 (예산 항목 없이도 전표 확정 가능)
  if (!plan) {
    return new Response(jsonKST({
      ok: true,
      data: { plan: null, lines: [], suggestedLineId: null },
    }), { headers: { "Content-Type": "application/json" } });
  }

  // ── 편성 항목 (관·항·목 + 옛 분류) ──
  let lines: { id: number; categoryId: number | null; budgetAccountId: number | null;
               categoryCode: string | null; categoryName: string; plannedAmount: number }[] = [];
  try {
    lines = (await loadBudgetLineViews(Number(plan.id))).map((l) => ({
      id: l.id, categoryId: l.categoryId, budgetAccountId: l.budgetAccountId,
      categoryCode: l.categoryCode, categoryName: l.categoryName, plannedAmount: l.plannedAmount,
    }));
  } catch (err) {
    return jsonError("select_lines", err);
  }

  // ── AI 1차 추천: 계정과목 → 예산 목 매핑 우선, 없으면 옛 분류 일치 ──
  let suggestedLineId: number | null = null;
  if (accountCode) {
    try {
      const mapped: any = await db.execute(sql`
        SELECT budget_account_id FROM budget_account_code_map WHERE account_code = ${accountCode}`);
      const ids = new Set((mapped?.rows ?? mapped ?? []).map((x: any) => Number(x.budget_account_id)));
      const byMok = lines.find((l) => l.budgetAccountId != null && ids.has(l.budgetAccountId));
      if (byMok) suggestedLineId = byMok.id;
      if (!suggestedLineId) {
        const r: any = await db.execute(sql`
          SELECT category FROM account_codes WHERE code = ${accountCode} LIMIT 1`);
        const cat = (r?.rows ?? r ?? [])[0]?.category;
        const match = cat ? lines.find((l) => l.categoryCode === cat) : undefined;
        if (match) suggestedLineId = match.id;
      }
    } catch { /* 추천 실패해도 목록은 정상 반환 */ }
  }

  return new Response(jsonKST({
    ok: true,
    data: {
      plan: { id: Number(plan.id), fiscalYear: Number(plan.fiscal_year), title: plan.title },
      lines,
      suggestedLineId,
    },
  }), { headers: { "Content-Type": "application/json" } });
}
