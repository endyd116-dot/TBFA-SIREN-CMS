/**
 * POST /api/admin-agency-delete
 * 외부 기관 비활성화 (soft delete — is_active = FALSE)
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-agency-delete" };

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({ ok: false, error: "기관 비활성화 실패", step, detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 1000) }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "POST only" }), { status: 405, headers: { "Content-Type": "application/json" } });
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  let body: any;
  try { body = await req.json(); } catch (err) { return jsonError("parse_body", err); }
  const { id } = body;
  if (!id || isNaN(Number(id))) return new Response(JSON.stringify({ ok: false, error: "id는 필수입니다" }), { status: 400, headers: { "Content-Type": "application/json" } });
  try {
    await db.execute(sql`UPDATE external_agencies SET is_active = FALSE, updated_at = NOW() WHERE id = ${Number(id)}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) { return jsonError("update_agency", err); }
};
