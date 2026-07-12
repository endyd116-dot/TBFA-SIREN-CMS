// netlify/functions/admin-auto-trigger-toggle.ts
// Phase 10 R4 — 자동 트리거 활성/비활성 토글 (어드민)
//
// POST ?id=X → is_active 반전

import { jsonKST } from "../../lib/kst";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-auto-trigger-toggle" };

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!id || isNaN(id)) {
    return new Response(jsonKST({ ok: false, error: "트리거 ID(id)가 필요합니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const existRes: any = await db.execute(sql`
      SELECT id, is_active FROM communication_auto_triggers
       WHERE id = ${id} AND deleted_at IS NULL LIMIT 1
    `);
    const trigger = (existRes?.rows ?? existRes ?? [])[0];
    if (!trigger) {
      return new Response(jsonKST({ ok: false, error: "트리거를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }

    const newActive = !trigger.is_active;
    await db.execute(sql`
      UPDATE communication_auto_triggers
         SET is_active = ${newActive}, updated_at = NOW()
       WHERE id = ${id}
    `);

    return new Response(
      jsonKST({ ok: true, id, isActive: newActive }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      jsonKST({
        ok: false, error: "트리거 토글 실패",
        step: "toggle", detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
