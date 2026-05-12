/**
 * /api/admin-ai-features
 *
 * GET  : 19개 AI 기능 목록 + 사용량(오늘·이번달) + 토글·기능별 한도
 * POST : 기능 토글 / 기능별 월 한도 변경
 *   body: { featureKey, enabled?, monthlyBudgetUsd? | null }
 *
 * 응답 (GET):
 *   {
 *     ok, totals: { today, month, limit, percentUsed },
 *     features: [
 *       { key, name, category, description, enabled,
 *         monthlyBudgetUsd, todayCost, todayCalls,
 *         monthCost, monthCalls, monthInputTokens, monthOutputTokens,
 *         sortOrder }
 *     ]
 *   }
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { getFeatureStats, invalidateFeatureCache, isKnownFeature, FEATURE_REGISTRY } from "../../lib/ai-feature";
import { getCostStats } from "../../lib/ai-cost-monitor";

export const config = { path: "/api/admin-ai-features" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  if (req.method === "GET") return handleGet();
  if (req.method === "POST") return handlePost(req);

  return new Response(JSON.stringify({ ok: false, error: "GET 또는 POST" }),
    { status: 405, headers: JSON_HEADER });
};

async function handleGet(): Promise<Response> {
  try {
    const [features, stats] = await Promise.all([
      getFeatureStats(),
      getCostStats(),
    ]);
    const percentUsed = stats.limit > 0 ? (stats.month.cost / stats.limit) * 100 : 0;

    return new Response(JSON.stringify({
      ok: true,
      totals: {
        today: stats.today,
        month: stats.month,
        limit: stats.limit,
        warnThreshold: stats.warnThreshold,
        percentUsed: Math.round(percentUsed * 10) / 10,
      },
      features,
      registered: FEATURE_REGISTRY.length,
    }), { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "기능 목록 조회 실패",
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
}

async function handlePost(req: Request): Promise<Response> {
  let body: any = {};
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "JSON 파싱 실패" }),
      { status: 400, headers: JSON_HEADER });
  }

  const featureKey = String(body?.featureKey || "").trim();
  if (!featureKey) {
    return new Response(JSON.stringify({ ok: false, error: "featureKey 필수" }),
      { status: 400, headers: JSON_HEADER });
  }
  if (!isKnownFeature(featureKey)) {
    return new Response(JSON.stringify({ ok: false, error: `등록되지 않은 기능: ${featureKey}` }),
      { status: 400, headers: JSON_HEADER });
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (typeof body?.enabled === "boolean") {
    updates.push("enabled");
    values.push(body.enabled);
  }
  if (body?.monthlyBudgetUsd !== undefined) {
    /* null 또는 숫자 */
    if (body.monthlyBudgetUsd === null || body.monthlyBudgetUsd === "") {
      updates.push("budget_null");
    } else {
      const n = Number(body.monthlyBudgetUsd);
      if (!Number.isFinite(n) || n < 0) {
        return new Response(JSON.stringify({ ok: false, error: "monthlyBudgetUsd는 0 이상 숫자 또는 null" }),
          { status: 400, headers: JSON_HEADER });
      }
      updates.push("budget_num");
      values.push(n);
    }
  }

  if (updates.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "변경 항목 없음 (enabled 또는 monthlyBudgetUsd)" }),
      { status: 400, headers: JSON_HEADER });
  }

  try {
    /* UPDATE 1회 — 양쪽 다 들어왔으면 둘 다 갱신 */
    if (updates.includes("enabled") && updates.includes("budget_null")) {
      await db.execute(sql`
        UPDATE ai_feature_settings
           SET enabled = ${values[0]}, monthly_budget_usd = NULL, updated_at = NOW()
         WHERE feature_key = ${featureKey}
      `);
    } else if (updates.includes("enabled") && updates.includes("budget_num")) {
      await db.execute(sql`
        UPDATE ai_feature_settings
           SET enabled = ${values[0]}, monthly_budget_usd = ${values[1]}, updated_at = NOW()
         WHERE feature_key = ${featureKey}
      `);
    } else if (updates.includes("enabled")) {
      await db.execute(sql`
        UPDATE ai_feature_settings
           SET enabled = ${values[0]}, updated_at = NOW()
         WHERE feature_key = ${featureKey}
      `);
    } else if (updates.includes("budget_null")) {
      await db.execute(sql`
        UPDATE ai_feature_settings
           SET monthly_budget_usd = NULL, updated_at = NOW()
         WHERE feature_key = ${featureKey}
      `);
    } else if (updates.includes("budget_num")) {
      await db.execute(sql`
        UPDATE ai_feature_settings
           SET monthly_budget_usd = ${values[0]}, updated_at = NOW()
         WHERE feature_key = ${featureKey}
      `);
    }

    /* 캐시 무효화 (30초 TTL 우회 즉시 반영) */
    invalidateFeatureCache(featureKey);

    return new Response(JSON.stringify({ ok: true, featureKey }), { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "기능 설정 변경 실패",
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
}
