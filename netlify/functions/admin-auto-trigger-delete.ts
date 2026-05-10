// netlify/functions/admin-auto-trigger-delete.ts
// Phase 10 R4 — 자동 트리거 소프트 삭제 (어드민)
//
// POST ?id=X → deleted_at = NOW(), is_active = false

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-auto-trigger-delete" };

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!id || isNaN(id)) {
    return new Response(JSON.stringify({ ok: false, error: "트리거 ID(id)가 필요합니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const existRes: any = await db.execute(sql`
      SELECT id FROM communication_auto_triggers WHERE id = ${id} AND deleted_at IS NULL LIMIT 1
    `);
    if (!(existRes?.rows ?? existRes ?? [])[0]) {
      return new Response(JSON.stringify({ ok: false, error: "트리거를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }

    await db.execute(sql`
      UPDATE communication_auto_triggers
         SET deleted_at = NOW(), is_active = false, updated_at = NOW()
       WHERE id = ${id}
    `);

    return new Response(JSON.stringify({ ok: true, id }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "트리거 삭제 실패",
        step: "soft_delete", detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
