/**
 * GET /api/admin/potential-donor-list
 *
 * 잠재 후원자(이벤트·활동 참여자) 목록 조회
 * Query: q, eventName, linked(all|no|yes|converted|regular|prospect|lead), page, pageSize
 *
 * 2026-10-18: «정식 회원 연결» 대신 «전환 상태»를 준다 — 연결된 회원의 후원 단계(lib/donor-stage.ts)
 *   stage: potential(잠재·미연결 또는 연결됐지만 후원 없음) | prospect_onetime | prospect_cancelled | regular
 *   linkedOverride: 그 회원에 운영자 수동 단계 지정이 걸려 있으면 true
 *   kpi: total · linked · unlinked(기존) + converted(예비·정기) · regular · prospectOnetime · prospectCancelled · lead(연결·미후원)
 */

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { STAGE_LABEL, stageFromMemberRow } from "../../lib/donor-stage";

export const config = { path: "/api/admin/potential-donor-list" };
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

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
  const linked = url.searchParams.get("linked") || "all"; // all|no|yes|converted|regular|prospect|lead
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10)));
  const offset = (page - 1) * pageSize;

  let rows: any[] = [];
  let total = 0;

  const qLike = q ? `%${q}%` : null;
  const evLike = eventName ? `%${eventName}%` : null;
  /* 전환 상태 필터 — 연결된 회원의 donor_type 기준 */
  const stageFilter =
    linked === "no" ? sql`AND pd.linked_member_id IS NULL`
    : linked === "yes" ? sql`AND pd.linked_member_id IS NOT NULL`
    : linked === "converted" ? sql`AND m.donor_type IN ('regular', 'prospect')`
    : linked === "regular" ? sql`AND m.donor_type = 'regular'`
    : linked === "prospect" ? sql`AND m.donor_type = 'prospect'`
    : linked === "lead" ? sql`AND pd.linked_member_id IS NOT NULL AND COALESCE(m.donor_type, 'none') = 'none'`
    : sql``;

  try {
    const dataRs: any = await db.execute(sql`
      SELECT
        pd.id, pd.name, pd.phone, pd.email, pd.address, pd.birthdate,
        pd.event_name, pd.participated_at, pd.entry_path, pd.memo,
        pd.linked_member_id, pd.linked_at, pd.linked_by,
        m.name AS linked_member_name, m.donor_type AS linked_donor_type, m.prospect_subtype AS linked_prospect_subtype,
        m.donor_evaluated_at AS linked_donor_evaluated_at, m.created_at AS linked_member_created_at,
        (COALESCE(m.prospect_entry_path, '') = 'potential_lead' OR COALESCE(m.email, '') ILIKE '%@noemail.%') AS linked_is_lead,
        pd.created_at, pd.updated_at
      FROM potential_donors pd
      LEFT JOIN members m ON m.id = pd.linked_member_id
      WHERE 1=1
        ${qLike ? sql`AND (pd.name ILIKE ${qLike} OR pd.phone ILIKE ${qLike})` : sql``}
        ${evLike ? sql`AND pd.event_name ILIKE ${evLike}` : sql``}
        ${stageFilter}
      ORDER BY pd.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    rows = rowsOf(dataRs);

    const totalRs: any = await db.execute(sql`
      SELECT COUNT(*)::int AS total FROM potential_donors pd
      LEFT JOIN members m ON m.id = pd.linked_member_id
      WHERE 1=1
        ${qLike ? sql`AND (pd.name ILIKE ${qLike} OR pd.phone ILIKE ${qLike})` : sql``}
        ${evLike ? sql`AND pd.event_name ILIKE ${evLike}` : sql``}
        ${stageFilter}
    `);
    total = Number(rowsOf(totalRs)[0]?.total) || 0;
  } catch (err) {
    return jsonError("select", err);
  }

  /* 수동 단계 지정 여부(표 없으면 전부 false) */
  const overrideSet = new Set<number>();
  try {
    const mids = [...new Set(rows.map((r) => Number(r.linked_member_id)).filter((n) => n > 0))];
    if (mids.length) {
      const ovRs: any = await db.execute(sql`
        SELECT DISTINCT member_id FROM donor_stage_events
         WHERE source = 'manual' AND is_override = TRUE AND released_at IS NULL
           AND member_id = ANY(${sql.raw(`ARRAY[${mids.join(",")}]::int[]`)})`);
      for (const r of rowsOf(ovRs)) overrideSet.add(Number(r.member_id));
    }
  } catch { /* 이력 표 없음(마이그 전) — 무시 */ }

  /* KPI */
  let kpi = { total: 0, linked: 0, unlinked: 0, converted: 0, regular: 0, prospectOnetime: 0, prospectCancelled: 0, lead: 0 };
  try {
    const kpiRs: any = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE pd.linked_member_id IS NOT NULL)::int AS linked,
        COUNT(*) FILTER (WHERE pd.linked_member_id IS NULL)::int AS unlinked,
        COUNT(*) FILTER (WHERE m.donor_type IN ('regular', 'prospect'))::int AS converted,
        COUNT(*) FILTER (WHERE m.donor_type = 'regular')::int AS regular,
        COUNT(*) FILTER (WHERE m.donor_type = 'prospect' AND m.prospect_subtype = 'onetime')::int AS prospect_onetime,
        COUNT(*) FILTER (WHERE m.donor_type = 'prospect' AND m.prospect_subtype = 'cancelled')::int AS prospect_cancelled,
        COUNT(*) FILTER (WHERE pd.linked_member_id IS NOT NULL AND COALESCE(m.donor_type, 'none') = 'none')::int AS lead
      FROM potential_donors pd
      LEFT JOIN members m ON m.id = pd.linked_member_id
    `);
    const kr = rowsOf(kpiRs)[0] || {};
    kpi = {
      total: Number(kr.total) || 0, linked: Number(kr.linked) || 0, unlinked: Number(kr.unlinked) || 0,
      converted: Number(kr.converted) || 0, regular: Number(kr.regular) || 0,
      prospectOnetime: Number(kr.prospect_onetime) || 0, prospectCancelled: Number(kr.prospect_cancelled) || 0, lead: Number(kr.lead) || 0,
    };
  } catch { /* KPI 실패 무시 */ }

  const data = rows.map((r) => {
    const linkedId = r.linked_member_id ? Number(r.linked_member_id) : null;
    const stage = linkedId ? stageFromMemberRow(r.linked_donor_type, r.linked_prospect_subtype, true) : "potential";
    return {
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
      linkedMemberId: linkedId,
      linkedMemberName: r.linked_member_name || null,
      linkedAt: r.linked_at ? new Date(r.linked_at).toISOString() : null,
      linkedBy: r.linked_by ? Number(r.linked_by) : null,
      linkMethod: linkedId ? (r.linked_by ? "manual" : "auto") : null,
      linkedDonorType: r.linked_donor_type || null,
      linkedProspectSubtype: r.linked_prospect_subtype || null,
      linkedIsLead: r.linked_is_lead === true,
      linkedDonorEvaluatedAt: r.linked_donor_evaluated_at ? new Date(r.linked_donor_evaluated_at).toISOString() : null,
      linkedOverride: linkedId ? overrideSet.has(linkedId) : false,
      stage,
      stageLabel: STAGE_LABEL[stage] + (linkedId ? "" : " · 미연결"),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    };
  });

  return new Response(jsonKST({
    ok: true, message: null,
    data: { ok: true, data, page, pageSize, total, kpi },
  }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
};
