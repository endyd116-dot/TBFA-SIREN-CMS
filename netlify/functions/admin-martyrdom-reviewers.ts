/**
 * admin-martyrdom-reviewers — 배정 가능한 운영자 목록 (§P3.2)
 *
 * GET  : members operator_active = true (검토자 배정 드롭다운)
 * 응답: { ok, reviewers:[{ id, name, role }] }
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-martyrdom-reviewers" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "GET만 허용" }), { status: 405 });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  try {
    const r: any = await db.execute(sql.raw(`
      SELECT id, name, role FROM members
      WHERE type = 'admin' AND status = 'active' AND operator_active = true
      ORDER BY (role = 'super_admin') DESC, name ASC
      LIMIT 100
    `));
    const reviewers = (r?.rows ?? r ?? []).map((row: any) => ({
      id: Number(row.id),
      name: row.name ? String(row.name) : `운영자#${row.id}`,
      role: row.role ? String(row.role) : "operator",
    }));
    return new Response(jsonKST({ ok: true, reviewers }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "처리 실패", step: "reviewers",
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
