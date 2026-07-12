/**
 * POST /api/admin-form-delete
 * body: { id }
 * 응답 데이터는 CASCADE로 함께 삭제됨. 응답이 1개라도 있으면 confirm=true 필수.
 */

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-form-delete" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST" && req.method !== "DELETE") {
    return new Response(jsonKST({ ok: false, error: "POST/DELETE만" }),
      { status: 405, headers: JSON_HEADER });
  }
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  let body: any = {};
  try { body = await req.json(); } catch {}
  const id = Number(body?.id || 0);
  if (!id) return new Response(jsonKST({ ok: false, error: "id 필수" }),
    { status: 400, headers: JSON_HEADER });

  try {
    const r: any = await db.execute(sql`
      SELECT title, (SELECT COUNT(*)::int FROM form_submissions WHERE form_id = ${id}) AS cnt
        FROM forms WHERE id = ${id} LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) return new Response(jsonKST({ ok: false, error: "없음" }),
      { status: 404, headers: JSON_HEADER });
    if (Number(row.cnt) > 0 && body.confirm !== true) {
      return new Response(jsonKST({
        ok: false, error: `이 폼에 응답 ${row.cnt}건이 있습니다. 모든 응답이 함께 삭제됩니다. confirm: true로 재호출해 주세요`,
        requiresConfirm: true,
      }), { status: 409, headers: JSON_HEADER });
    }
    await db.execute(sql`DELETE FROM forms WHERE id = ${id}`);
    return new Response(jsonKST({ ok: true, deleted: row.title }),
      { status: 200, headers: JSON_HEADER });
  } catch (e: any) {
    return new Response(jsonKST({
      ok: false, error: "삭제 실패", detail: String(e?.message || e).slice(0, 300),
    }), { status: 500, headers: JSON_HEADER });
  }
};
