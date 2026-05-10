import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-finance-budget-upsert" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { fiscalYear, categoryId, plannedAmount, note } = body;
  if (!fiscalYear || !categoryId || plannedAmount === undefined) {
    return new Response(
      JSON.stringify({ ok: false, error: "fiscalYear, categoryId, plannedAmount 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    await db.execute(sql`
      INSERT INTO budgets (fiscal_year, category_id, planned_amount, note, created_by)
      VALUES (${fiscalYear}, ${categoryId}, ${plannedAmount}, ${note || null}, ${auth.ctx.admin.uid})
      ON CONFLICT (fiscal_year, category_id)
      DO UPDATE SET planned_amount = EXCLUDED.planned_amount, note = EXCLUDED.note
    `);
    return new Response(
      JSON.stringify({ ok: true, message: "예산 편성 완료" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "예산 편성 실패", step: "upsert",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
