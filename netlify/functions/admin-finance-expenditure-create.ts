import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-finance-expenditure-create" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST")
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), { status: 405 });

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { categoryId, amount, spentAt, description, payee, receiptUrl, note } = body;
  if (!categoryId || !amount || !spentAt || !description) {
    return new Response(
      JSON.stringify({ ok: false, error: "categoryId, amount, spentAt, description 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const [row] = await db.execute(sql`
      INSERT INTO expenditures
        (category_id, amount, spent_at, description, payee, receipt_url, note, created_by, status)
      VALUES
        (${categoryId}, ${amount}, ${spentAt}, ${description},
         ${payee || null}, ${receiptUrl || null}, ${note || null},
         ${auth.ctx.admin.uid}, 'draft')
      RETURNING id
    `);
    return new Response(
      JSON.stringify({ ok: true, id: (row as any)?.id, message: "지출 기안 저장 완료" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "지출 기안 저장 실패", step: "insert",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
