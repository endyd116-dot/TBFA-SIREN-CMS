/**
 * GET /api/admin/potential-donor-list
 *
 * 잠재 후원자(이벤트·활동 참여자) 목록 조회
 * Query: q, eventName, linked(all|yes|no), page, pageSize
 */

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin/potential-donor-list" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "잠재 후원자 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
  if (req.method !== "GET") return new Response(jsonKST({ ok: false, error: "Method Not Allowed" }), { status: 405, headers: { "Content-Type": "application/json; charset=utf-8" } });

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const eventName = url.searchParams.get("eventName")?.trim() || "";
  const linked = url.searchParams.get("linked") || "all"; // all|yes|no
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10)));
  const offset = (page - 1) * pageSize;

  let rows: any[] = [];
  let total = 0;

  try {
    const qLike = q ? `%${q}%` : null;
    const evLike = eventName ? `%${eventName}%` : null;

    const dataRs: any = await db.execute(sql`
      SELECT
        pd.id, pd.name, pd.phone, pd.email, pd.address, pd.birthdate,
        pd.event_name, pd.participated_at, pd.entry_path, pd.memo,
        pd.linked_member_id, pd.linked_at,
        m.name AS linked_member_name,
        pd.created_at, pd.updated_at
      FROM potential_donors pd
      LEFT JOIN members m ON m.id = pd.linked_member_id
      WHERE 1=1
        ${qLike ? sql`AND (pd.name ILIKE ${qLike} OR pd.phone ILIKE ${qLike})` : sql``}
        ${evLike ? sql`AND pd.event_name ILIKE ${evLike}` : sql``}
        ${linked === "yes" ? sql`AND pd.linked_member_id IS NOT NULL` : sql``}
        ${linked === "no" ? sql`AND pd.linked_member_id IS NULL` : sql``}
      ORDER BY pd.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    rows = Array.isArray(dataRs) ? dataRs : (dataRs as any).rows || [];

    const totalRs: any = await db.execute(sql`
      SELECT COUNT(*)::int AS total FROM potential_donors pd
      WHERE 1=1
        ${qLike ? sql`AND (pd.name ILIKE ${qLike} OR pd.phone ILIKE ${qLike})` : sql``}
        ${evLike ? sql`AND pd.event_name ILIKE ${evLike}` : sql``}
        ${linked === "yes" ? sql`AND pd.linked_member_id IS NOT NULL` : sql``}
        ${linked === "no" ? sql`AND pd.linked_member_id IS NULL` : sql``}
    `);
    total = Number((Array.isArray(totalRs) ? totalRs[0] : (totalRs as any).rows?.[0])?.total) || 0;
  } catch (err) {
    return jsonError("select", err);
  }

  /* KPI */
  let kpi = { total: 0, linked: 0, unlinked: 0 };
  try {
    const kpiRs: any = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE linked_member_id IS NOT NULL)::int AS linked,
        COUNT(*) FILTER (WHERE linked_member_id IS NULL)::int AS unlinked
      FROM potential_donors
    `);
    const kr = (Array.isArray(kpiRs) ? kpiRs[0] : (kpiRs as any).rows?.[0]) || {};
    kpi = { total: Number(kr.total) || 0, linked: Number(kr.linked) || 0, unlinked: Number(kr.unlinked) || 0 };
  } catch { /* KPI 실패 무시 */ }

  const data = rows.map(r => ({
    id: Number(r.id),
    name: r.name || "",
    phone: r.phone || null,
    email: r.email || null,
    address: r.address || null,
    birthdate: r.birthdate || null,
    eventName: r.event_name || null,
    participatedAt: r.participated_at ? new Date(r.participated_at).toISOString() : null,
    entryPath: r.entry_path || null,
    memo: r.memo || null,
    linkedMemberId: r.linked_member_id ? Number(r.linked_member_id) : null,
    linkedMemberName: r.linked_member_name || null,
    linkedAt: r.linked_at ? new Date(r.linked_at).toISOString() : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  }));

  return new Response(jsonKST({
    ok: true, message: null,
    data: { ok: true, data, page, pageSize, total, kpi },
  }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
};
