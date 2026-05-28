/**
 * admin-martyrdom-external-list — R43 외부 자료 목록
 *
 * GET ?status=pending&limit=50
 *   → { ok, items:[{id,title,sourceUrl,sourceDomain,searchEngine,publishedAt,snippet,status}] }
 *
 * 권한: requireAdmin (조회는 admin 전체 — 검토 권한 없어도 목록은 봄)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-martyrdom-external-list" };

const ALLOWED_STATUS = new Set(["pending", "reviewing", "approved", "rejected", "all"]);

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "목록 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "GET만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const status = String(url.searchParams.get("status") || "pending");
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") || "50")), 200);

  if (!ALLOWED_STATUS.has(status)) {
    return new Response(JSON.stringify({ ok: false, error: "status는 pending|reviewing|approved|rejected|all" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const rows: any[] = await (async () => {
      if (status === "all") {
        const r: any = await db.execute(sql`
          SELECT id, title, source_url, source_domain, search_engine,
                 published_at, snippet, status
            FROM martyrdom_external_research
           ORDER BY created_at DESC
           LIMIT ${limit}
        `);
        return r?.rows ?? r ?? [];
      } else {
        const r: any = await db.execute(sql`
          SELECT id, title, source_url, source_domain, search_engine,
                 published_at, snippet, status
            FROM martyrdom_external_research
           WHERE status = ${status}
           ORDER BY created_at DESC
           LIMIT ${limit}
        `);
        return r?.rows ?? r ?? [];
      }
    })();

    const items = rows.map((r: any) => ({
      id:           Number(r.id),
      title:        String(r.title || ""),
      sourceUrl:    r.source_url || null,
      sourceDomain: r.source_domain || null,
      searchEngine: String(r.search_engine || ""),
      publishedAt:  r.published_at ? new Date(r.published_at).toISOString() : null,
      snippet:      r.snippet || null,
      status:       String(r.status || "pending"),
    }));

    return new Response(JSON.stringify({ ok: true, items }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("select_list", err);
  }
};
