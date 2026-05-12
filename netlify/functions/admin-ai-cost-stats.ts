/**
 * GET /api/admin-ai-cost-stats
 *
 * AI 비용 통계 — 오늘·이번 달 누적 + 최근 14일 일별 + 한도 정보
 *
 * Response:
 *   {
 *     ok: true,
 *     today:   { cost, inputTokens, outputTokens, calls },
 *     month:   { cost, inputTokens, outputTokens, calls },
 *     limit:   100,
 *     warnThreshold: 80,
 *     warn:    boolean,           // 경고 임계 도달 여부
 *     blocked: boolean,           // 차단 상태 여부
 *     percentUsed: number,        // 0~100
 *     recentDays: [{ date, cost, calls }],
 *     message?: string
 *   }
 */

import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { getCostStats, checkMonthlyBudget } from "../../lib/ai-cost-monitor";
import { getFeatureStats } from "../../lib/ai-feature";

export const config = { path: "/api/admin-ai-cost-stats" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "GET만 허용" }),
      { status: 405, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  try {
    const url = new URL(req.url);
    const includeFeatures = url.searchParams.get("features") === "1";

    const [stats, budget, features] = await Promise.all([
      getCostStats(),
      checkMonthlyBudget(),
      includeFeatures ? getFeatureStats() : Promise.resolve([]),
    ]);

    const percentUsed = stats.limit > 0 ? (stats.month.cost / stats.limit) * 100 : 0;

    return new Response(JSON.stringify({
      ok: true,
      today: stats.today,
      month: stats.month,
      limit: stats.limit,
      warnThreshold: stats.warnThreshold,
      warn: budget.warn,
      blocked: !budget.ok,
      percentUsed: Math.round(percentUsed * 10) / 10,
      recentDays: stats.recentDays,
      message: budget.message || "",
      ...(includeFeatures ? { features } : {}),
    }), { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "비용 통계 조회 실패",
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
};
