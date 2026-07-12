/**
 * admin-martyrdom-external-settings — R43 외부 자료 설정 GET·PATCH
 *
 * GET   → { ok, settings:{ whitelistDomains:[...], defaultQueries:[...] } }
 * PATCH { whitelistDomains?, defaultQueries? }  → { ok, settings:{...} }
 *
 * 권한: requireAdmin (settings 편집은 admin만 — 운영자도 조회는 가능하지만 일관성 위해 admin로)
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-martyrdom-external-settings" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "설정 처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function badRequest(msg: string) {
  return new Response(jsonKST({ ok: false, error: msg }),
    { status: 400, headers: { "Content-Type": "application/json" } });
}

async function loadSettings(): Promise<{ whitelistDomains: string[]; defaultQueries: string[] }> {
  const r: any = await db.execute(sql`
    SELECT whitelist_domains, default_queries
      FROM martyrdom_external_settings ORDER BY id ASC LIMIT 1
  `);
  const row = (r?.rows ?? r ?? [])[0];
  return {
    whitelistDomains: Array.isArray(row?.whitelist_domains) ? row.whitelist_domains as string[] : [],
    defaultQueries:   Array.isArray(row?.default_queries)   ? row.default_queries   as string[] : [],
  };
}

function normalizeStringArray(input: any, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    const s = String(v || "").trim();
    if (!s) continue;
    out.push(s.slice(0, maxLen));
    if (out.length >= maxItems) break;
  }
  return out;
}

export default async (req: Request, _ctx: Context) => {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  if (req.method === "GET") {
    try {
      const settings = await loadSettings();
      return new Response(jsonKST({ ok: true, settings }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("select_settings", err);
    }
  }

  if (req.method === "PATCH") {
    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }

    /* 행이 없으면 새로 생성 (마이그 호출 누락 안전망) */
    try {
      const cr: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM martyrdom_external_settings`);
      const cnt = Number((cr?.rows ?? cr ?? [])[0]?.n) || 0;
      if (cnt === 0) {
        await db.execute(sql`
          INSERT INTO martyrdom_external_settings (whitelist_domains, default_queries)
          VALUES ('[]'::jsonb, '[]'::jsonb)
        `);
      }
    } catch (err: any) {
      return jsonError("ensure_row", err);
    }

    /* 부분 갱신 */
    try {
      if (body && Array.isArray(body.whitelistDomains)) {
        const norm = normalizeStringArray(body.whitelistDomains, 200, 200);
        const json = JSON.stringify(norm);
        await db.execute(sql`
          UPDATE martyrdom_external_settings
             SET whitelist_domains = ${json}::jsonb
        `);
      }
      if (body && Array.isArray(body.defaultQueries)) {
        const norm = normalizeStringArray(body.defaultQueries, 50, 200);
        const json = JSON.stringify(norm);
        await db.execute(sql`
          UPDATE martyrdom_external_settings
             SET default_queries = ${json}::jsonb
        `);
      }
      const settings = await loadSettings();
      return new Response(jsonKST({ ok: true, settings }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("update_settings", err);
    }
  }

  return new Response(jsonKST({ ok: false, error: "GET·PATCH만 허용" }),
    { status: 405, headers: { "Content-Type": "application/json" } });
};
