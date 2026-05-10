// netlify/functions/admin-recipient-group-delete.ts
// Phase 10 R2 — 수신자 그룹 soft delete (is_active=false)

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-recipient-group-delete" };

const JSON_HEADER = { "Content-Type": "application/json" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response(
      JSON.stringify({ ok: false, error: "id가 올바르지 않습니다.", step: "validate" }),
      { status: 400, headers: JSON_HEADER },
    );
  }

  try {
    const existsRes: any = await db.execute(
      sql`SELECT id, is_active FROM recipient_groups WHERE id = ${id} LIMIT 1`,
    );
    const rows = existsRes?.rows ?? existsRes ?? [];
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "그룹을 찾을 수 없습니다.", step: "not_found" }),
        { status: 404, headers: JSON_HEADER },
      );
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "그룹 조회 실패", step: "select_existing",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }

  try {
    const adminId = (auth as any).ctx.admin.uid;
    await db.execute(sql`
      UPDATE recipient_groups
      SET is_active = false, updated_by = ${adminId}, updated_at = NOW()
      WHERE id = ${id}
    `);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "그룹 삭제 실패", step: "update",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }
}
