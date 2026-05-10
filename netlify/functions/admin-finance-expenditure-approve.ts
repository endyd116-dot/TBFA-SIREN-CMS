import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-finance-expenditure-approve" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "PATCH")
    return new Response(JSON.stringify({ ok: false, error: "PATCH only" }), { status: 405 });

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { id, action, note } = body; // action: 'approve' | 'reject'
  if (!id || !["approve", "reject"].includes(action)) {
    return new Response(
      JSON.stringify({ ok: false, error: "id, action(approve|reject) 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const newStatus = action === "approve" ? "approved" : "rejected";

  try {
    await db.execute(sql`
      UPDATE expenditures
      SET status = ${newStatus},
          approved_by = ${auth.admin?.id || null},
          approved_at = NOW(),
          note = COALESCE(${note || null}, note)
      WHERE id = ${id} AND status = 'draft'
    `);
    return new Response(
      JSON.stringify({ ok: true, message: action === "approve" ? "승인 완료" : "반려 완료" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "지출 처리 실패", step: "update",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
