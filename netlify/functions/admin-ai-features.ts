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
import { canAccess } from "../../lib/role-permission-check";
import { getFeatureStats, invalidateFeatureCache, isKnownFeature, getFeatureMeta, FEATURE_REGISTRY } from "../../lib/ai-feature";
import { getCostStats } from "../../lib/ai-cost-monitor";

export const config = { path: "/api/admin-ai-features" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  // R45 §4(AI): AI 기능 토글·월한도·통계는 admin+ (운영자 차단·권한정책 토글)
  if (!(await canAccess((auth as any).ctx.member.role ?? "", "ai_config"))) {
    return new Response(JSON.stringify({ ok: false, error: "AI 설정 권한이 없습니다", step: "auth_role" }), { status: 403, headers: JSON_HEADER });
  }

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
    /* UPSERT — row 없는 신규 featureKey도 토글·한도 저장되도록 (UPDATE-only는 0건 영향)
       INSERT 시 누락 메타(name·category·sortOrder)는 카탈로그에서 보충. */
    const meta = getFeatureMeta(featureKey);
    const hasEnabled = updates.includes("enabled");
    const hasBudgetNull = updates.includes("budget_null");
    const hasBudgetNum = updates.includes("budget_num");

    /* 입력 안 된 항목의 INSERT 기본값: enabled=true(스키마 default), budget=NULL */
    const enabledVal = hasEnabled ? (values[0] as boolean) : true;
    const budgetVal: number | null = hasBudgetNum ? (values[hasEnabled ? 1 : 0] as number) : null;

    /* ON CONFLICT에서 갱신할 컬럼 — 들어온 항목만 (보내지 않은 항목은 기존값 보존) */
    if (hasEnabled && (hasBudgetNull || hasBudgetNum)) {
      await db.execute(sql`
        INSERT INTO ai_feature_settings (feature_key, feature_name, category, description, enabled, monthly_budget_usd, sort_order)
        VALUES (${featureKey}, ${meta?.name ?? featureKey}, ${meta?.category ?? "admin_action"}, ${meta?.description ?? null}, ${enabledVal}, ${budgetVal}, ${meta?.sortOrder ?? 100})
        ON CONFLICT (feature_key) DO UPDATE
           SET enabled = ${enabledVal}, monthly_budget_usd = ${budgetVal}, updated_at = NOW()
      `);
    } else if (hasEnabled) {
      await db.execute(sql`
        INSERT INTO ai_feature_settings (feature_key, feature_name, category, description, enabled, sort_order)
        VALUES (${featureKey}, ${meta?.name ?? featureKey}, ${meta?.category ?? "admin_action"}, ${meta?.description ?? null}, ${enabledVal}, ${meta?.sortOrder ?? 100})
        ON CONFLICT (feature_key) DO UPDATE
           SET enabled = ${enabledVal}, updated_at = NOW()
      `);
    } else if (hasBudgetNull || hasBudgetNum) {
      await db.execute(sql`
        INSERT INTO ai_feature_settings (feature_key, feature_name, category, description, enabled, monthly_budget_usd, sort_order)
        VALUES (${featureKey}, ${meta?.name ?? featureKey}, ${meta?.category ?? "admin_action"}, ${meta?.description ?? null}, ${enabledVal}, ${budgetVal}, ${meta?.sortOrder ?? 100})
        ON CONFLICT (feature_key) DO UPDATE
           SET monthly_budget_usd = ${budgetVal}, updated_at = NOW()
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
