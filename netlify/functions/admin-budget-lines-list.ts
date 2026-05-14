import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-budget-lines-list" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
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
    return new Response(JSON.stringify({ ok: false, error: "유효한 year 파라미터가 필요합니다." }),
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
    return new Response(JSON.stringify({
      ok: true,
      data: { plan: null, lines: [], suggestedLineId: null },
    }), { headers: { "Content-Type": "application/json" } });
  }

  // ── 편성 항목 (분류명 join) ──────────────────────────────
  let lines: any[] = [];
  try {
    const r: any = await db.execute(sql`
      SELECT bl.id, bl.category_id, bl.planned_amount,
             ec.code AS category_code, ec.name AS category_name
      FROM budget_lines bl
      JOIN expense_categories ec ON ec.id = bl.category_id
      WHERE bl.plan_id = ${Number(plan.id)}
      ORDER BY ec.sort_order, ec.id`);
    lines = (r?.rows ?? r ?? []).map((x: any) => ({
      id:            Number(x.id),
      categoryId:    Number(x.category_id),
      categoryCode:  x.category_code,
      categoryName:  x.category_name,
      plannedAmount: Number(x.planned_amount),
    }));
  } catch (err) {
    return jsonError("select_lines", err);
  }

  // ── AI 1차 추천: 계정과목 분류 → 같은 분류의 예산 항목 ───
  let suggestedLineId: number | null = null;
  if (accountCode) {
    try {
      const r: any = await db.execute(sql`
        SELECT category FROM account_codes WHERE code = ${accountCode} LIMIT 1`);
      const cat = (r?.rows ?? r ?? [])[0]?.category;
      if (cat) {
        const match = lines.find((l) => l.categoryCode === cat);
        if (match) suggestedLineId = match.id;
      }
    } catch { /* 추천 실패해도 목록은 정상 반환 */ }
  }

  return new Response(JSON.stringify({
    ok: true,
    data: {
      plan: { id: Number(plan.id), fiscalYear: Number(plan.fiscal_year), title: plan.title },
      lines,
      suggestedLineId,
    },
  }), { headers: { "Content-Type": "application/json" } });
}
