/**
 * GET /api/admin-ai-usage-logs
 *
 * AI 호출 상세 로그 조회 — 비용 폭증 시 원인 추적용
 *
 * Query:
 *   feature?    — feature_key 정확 일치
 *   from?, to?  — created_at 범위 (YYYY-MM-DD)
 *   minCost?    — 최소 비용 (예: 0.001)
 *   sort?       — recent (기본) | cost (비용 큰 순)
 *   limit (기본 50, 최대 200)
 *   offset
 *
 * Response:
 *   { ok, total, rows[], totals: {cost, calls, inputTokens, outputTokens} }
 */

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";

export const config = { path: "/api/admin-ai-usage-logs" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "GET만 허용" }),
      { status: 405, headers: JSON_HEADER });
  }
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  // R45 §4(AI): AI 사용 로그는 admin+ (관리자별 사용내역·운영자 차단·권한정책 토글)
  if (!(await canAccess((auth as any).ctx.member.role ?? "", "ai_config"))) {
    return new Response(jsonKST({ ok: false, error: "AI 사용 로그 권한이 없습니다", step: "auth_role" }), { status: 403, headers: JSON_HEADER });
  }

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0"), 0);
  const feature = (url.searchParams.get("feature") || "").trim();
  const from = (url.searchParams.get("from") || "").trim();
  const to = (url.searchParams.get("to") || "").trim();
  const minCost = Number(url.searchParams.get("minCost") || "0");
  const sort = url.searchParams.get("sort") === "cost" ? "cost" : "recent";

  const conds: any[] = [];
  if (feature) conds.push(sql`feature_key = ${feature}`);
  if (from) conds.push(sql`created_at >= ${from}::timestamptz`);
  if (to) conds.push(sql`created_at < (${to}::timestamptz + INTERVAL '1 day')`);
  if (minCost > 0) conds.push(sql`cost_usd::float >= ${minCost}`);
  const where = conds.length > 0
    ? sql`WHERE ${sql.join(conds, sql` AND `)}`
    : sql``;
  const orderBy = sort === "cost"
    ? sql`cost_usd DESC, created_at DESC`
    : sql`created_at DESC`;

  try {
    const r: any = await db.execute(sql`
      SELECT l.id, l.feature_key, l.model, l.admin_id, m.name AS admin_name,
             l.input_tokens, l.output_tokens, l.cached_tokens,
             l.cost_usd::float AS cost_usd,
             l.duration_ms, l.success, l.error, l.created_at
        FROM ai_usage_logs l
        LEFT JOIN members m ON m.id = l.admin_id
        ${where}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = r?.rows ?? r ?? [];

    const tr: any = await db.execute(sql`
      SELECT COUNT(*)::int AS calls,
             COALESCE(SUM(cost_usd::float), 0) AS cost,
             COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
             COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens
        FROM ai_usage_logs ${where}
    `);
    const t = (tr?.rows ?? tr ?? [])[0] || {};

    return new Response(jsonKST({
      ok: true,
      total: Number(t.calls) || 0,
      rows,
      totals: {
        cost: Number(t.cost) || 0,
        calls: Number(t.calls) || 0,
        inputTokens: Number(t.input_tokens) || 0,
        outputTokens: Number(t.output_tokens) || 0,
      },
    }), { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "로그 조회 실패",
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
};
