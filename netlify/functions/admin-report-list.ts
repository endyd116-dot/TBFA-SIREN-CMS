/**
 * GET /api/admin-report-list
 *
 * Phase 4 — 대표 보고서 목록 조회
 *
 * Query:
 *   ?type=weekly|custom|all  (기본 all)
 *   ?limit=20                (기본 20, 최대 100)
 *   ?page=1                  (기본 1)
 */

import type { Context } from "@netlify/functions";
import { db, reportSnapshots, members } from "../../db";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    JSON.stringify({ ok: false, error: "보고서 목록 조회 실패", step, detail: String(err?.message || err).slice(0, 500) }),
    { status, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
  }
  if (req.method !== "GET") return new Response(JSON.stringify({ ok: false, error: "GET only" }), { status: 405, headers: { "Content-Type": "application/json; charset=utf-8" } });

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "all";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);
  const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10), 1);
  const offset = (page - 1) * limit;

  let rows: any[];
  try {
    rows = await db
      .select({
        id: reportSnapshots.id,
        reportType: reportSnapshots.reportType,
        periodStart: reportSnapshots.periodStart,
        periodEnd: reportSnapshots.periodEnd,
        aiSummary: reportSnapshots.aiSummary,
        aiAlerts: reportSnapshots.aiAlerts,
        generatedBy: reportSnapshots.generatedBy,
        sentEmailAt: reportSnapshots.sentEmailAt,
        sentTo: reportSnapshots.sentTo,
        createdAt: reportSnapshots.createdAt,
      })
      .from(reportSnapshots)
      .orderBy(desc(reportSnapshots.createdAt))
      .limit(limit)
      .offset(offset);
  } catch (err) { return jsonError("select_reports", err); }

  return new Response(
    JSON.stringify({ ok: true, data: { reports: rows, page, limit } }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};

export const config = { path: "/api/admin-report-list" };
