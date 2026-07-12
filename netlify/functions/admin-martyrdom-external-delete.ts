/**
 * admin-martyrdom-external-delete — R43 외부 자료 영구 삭제 (rejected만)
 *
 * DELETE ?id=N
 *   - status='rejected' 인 행만 허용 (실수 방지)
 *   - 'martyr_external' RAG 청크도 삭제
 *   → { ok }
 *
 * 권한: requireAdmin (조회는 운영자 포함이지만 삭제는 admin만)
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-martyrdom-external-delete" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "삭제 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function badRequest(msg: string) {
  return new Response(jsonKST({ ok: false, error: msg }),
    { status: 400, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "DELETE") return badRequest("DELETE만 허용");

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id") || "0");
  if (!id) return badRequest("id 필수");

  try {
    const r: any = await db.execute(sql`
      SELECT status FROM martyrdom_external_research WHERE id = ${id} LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) {
      return new Response(jsonKST({ ok: false, error: "외부 자료를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (String(row.status) !== "rejected") {
      return badRequest("기각된 자료만 삭제할 수 있습니다");
    }
  } catch (err: any) {
    return jsonError("select_status", err);
  }

  /* RAG 청크 정리 (pending 시 색인됐을 수 있음 — fail-open 정리) */
  try {
    const refLike = `martyr-external:${id}#%`;
    await db.execute(sql`
      DELETE FROM ai_rag_documents
       WHERE source_type='martyr_external' AND source_ref LIKE ${refLike}
    `);
  } catch (e: any) {
    console.warn(`[external-delete] RAG 청크 정리 실패 (id=${id}): ${e?.message}`);
  }

  try {
    await db.execute(sql`DELETE FROM martyrdom_external_research WHERE id = ${id}`);
    return new Response(jsonKST({ ok: true }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("delete_row", err);
  }
};
