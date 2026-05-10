// netlify/functions/admin-template-delete.ts
// Phase 10 R1 — 발송 템플릿 soft delete (is_active=false)

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-template-delete" };

const JSON_HEADER = { "Content-Type": "application/json" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: "id 파라미터가 필요합니다." }), {
      status: 400,
      headers: JSON_HEADER,
    });
  }

  try {
    const existRes: any = await db.execute(
      sql`SELECT id FROM communication_templates WHERE id = ${id} LIMIT 1`
    );
    const exist = (existRes?.rows ?? existRes ?? [])[0];
    if (!exist) {
      return new Response(JSON.stringify({ ok: false, error: "템플릿을 찾을 수 없습니다." }), {
        status: 404,
        headers: JSON_HEADER,
      });
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "템플릿 조회 실패", step: "select_exist",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }

  try {
    const adminId = auth.ctx.admin.uid;
    await db.execute(
      sql`UPDATE communication_templates
          SET is_active  = false,
              updated_by = ${adminId},
              updated_at = NOW()
          WHERE id = ${id}`
    );

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: JSON_HEADER,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "템플릿 삭제 실패", step: "soft_delete",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }
}
