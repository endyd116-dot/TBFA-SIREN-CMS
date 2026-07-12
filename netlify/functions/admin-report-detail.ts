/**
 * GET /api/admin-report-detail?id=N
 *
 * Phase 4 — 대표 보고서 상세 조회 (stats 포함)
 */

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db, reportSnapshots } from "../../db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    jsonKST({ ok: false, error: "보고서 상세 조회 실패", step, detail: String(err?.message || err).slice(0, 500) }),
    { status, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
  }
  if (req.method !== "GET") return new Response(jsonKST({ ok: false, error: "GET only" }), { status: 405, headers: { "Content-Type": "application/json; charset=utf-8" } });

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!id || id <= 0) return new Response(jsonKST({ ok: false, error: "id 파라미터 필요" }), { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } });

  let rows: any[];
  try {
    rows = await db.select().from(reportSnapshots).where(eq(reportSnapshots.id, id)).limit(1);
  } catch (err) { return jsonError("select_report", err); }

  if (!rows[0]) return new Response(jsonKST({ ok: false, error: "보고서를 찾을 수 없음" }), { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } });

  return new Response(
    jsonKST({ ok: true, data: { report: rows[0] } }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};

export const config = { path: "/api/admin-report-detail" };
