/**
 * admin-martyrdom-external-detail — R43 외부 자료 상세
 *
 * GET ?id=N → { ok, item:{...전체 컬럼} }
 *
 * 권한: requireAdmin
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-martyrdom-external-detail" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "상세 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "GET만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id") || "0");
  if (!id) {
    return new Response(jsonKST({ ok: false, error: "id 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const r: any = await db.execute(sql`
      SELECT id, title, source_url, source_domain, search_engine, search_query,
             published_at, snippet, content_full, status,
             reviewed_by_uid, reviewed_at, rejection_reason, promoted_case_id,
             meta, created_at
        FROM martyrdom_external_research WHERE id = ${id} LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) {
      return new Response(jsonKST({ ok: false, error: "외부 자료를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
    const item = {
      id:              Number(row.id),
      title:           String(row.title || ""),
      sourceUrl:       row.source_url || null,
      sourceDomain:    row.source_domain || null,
      searchEngine:    String(row.search_engine || ""),
      searchQuery:     row.search_query || null,
      publishedAt:     row.published_at ? new Date(row.published_at).toISOString() : null,
      snippet:         row.snippet || null,
      contentFull:     row.content_full || null,
      status:          String(row.status || "pending"),
      reviewedByUid:   row.reviewed_by_uid != null ? Number(row.reviewed_by_uid) : null,
      reviewedAt:      row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
      rejectionReason: row.rejection_reason || null,
      promotedCaseId:  row.promoted_case_id != null ? Number(row.promoted_case_id) : null,
      meta:            row.meta || {},
      createdAt:       row.created_at ? new Date(row.created_at).toISOString() : null,
    };
    return new Response(jsonKST({ ok: true, item }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("select_detail", err);
  }
};
