/**
 * GET /api/admin-ledger-history?entity=voucher&entityId=12&limit=100&offset=0
 * 장부 변경 이력. entity를 생략하면 전체를 최근 순으로 돌려준다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-ledger-history" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "GET 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const entity = String(url.searchParams.get("entity") || "");
  const entityId = String(url.searchParams.get("entityId") || "");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  try {
    const res = await db.execute(sql`
      SELECT id, entity, entity_id, action, actor_id, actor_name, reason, before_data, after_data,
             to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS created_kst
        FROM ledger_history
       WHERE (${entity} = '' OR entity = ${entity})
         AND (${entityId} = '' OR entity_id = ${entityId})
       ORDER BY id DESC
       LIMIT ${limit} OFFSET ${offset}`);
    const items = rowsOf(res).map((r: any) => ({
      id: Number(r.id), entity: r.entity, entityId: r.entity_id, action: r.action,
      actorId: r.actor_id == null ? null : Number(r.actor_id), actorName: r.actor_name,
      reason: r.reason, before: r.before_data, after: r.after_data, createdAt: r.created_kst,
    }));
    return new Response(jsonKST({ ok: true, data: { items, limit, offset } }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "변경 이력 조회 실패", step: "select",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
