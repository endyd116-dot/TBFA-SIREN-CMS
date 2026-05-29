import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-finance-budget-upsert" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { fiscalYear, categoryId, plannedAmount, note } = body;
  if (!fiscalYear || !categoryId || plannedAmount === undefined) {
    return new Response(
      JSON.stringify({ ok: false, error: "fiscalYear, categoryId, plannedAmount 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // AD-069: 이 API는 폐기된 `budgets` 테이블에 쓰던 데드 코드(어느 화면도 호출 안 함).
  // 예산 편성은 22-B-R2부터 예산안(budget_plans/budget_lines) 결재 흐름으로 이관됨
  // (admin-budget-plan-create/-submit/-approve). 잘못 호출 시 폐기 테이블 INSERT로
  // 항상 500이 나던 잠재 장애를 제거하고, 올바른 흐름을 안내하는 410으로 명시 차단.
  void fiscalYear; void categoryId; void plannedAmount; void note;
  return new Response(
    JSON.stringify({
      ok: false,
      error: "이 예산 편성 API는 폐기되었습니다. 예산안 작성·결재(예산 편성) 화면을 사용하세요.",
      step: "deprecated",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } }
  );
}
