// netlify/functions/admin-recipient-groups-list.ts
// Phase 10 R2 — 수신자 그룹 목록 조회 (검색·페이지네이션 + memberCount 동적 계산)

import { isoUTC } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  RecipientCriteria,
  resolveRecipients,
  summarizeCriteria,
} from "../../lib/recipient-resolve";

export const config = { path: "/api/admin-recipient-groups-list" };

const JSON_HEADER = { "Content-Type": "application/json" };

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "수신자 그룹 목록 조회 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: JSON_HEADER },
  );
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";
  const includeInactive = url.searchParams.get("includeInactive") === "1";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

  let rows: any[] = [];
  let total = 0;

  try {
    const conditions: ReturnType<typeof sql>[] = [];
    if (!includeInactive) conditions.push(sql`is_active = true`);
    if (q) conditions.push(sql`(name ILIKE ${"%" + q + "%"} OR description ILIKE ${"%" + q + "%"})`);

    const whereFragment =
      conditions.length > 0
        ? sql`WHERE ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`
        : sql``;

    const rowsRes: any = await db.execute(
      sql`SELECT id, name, description, criteria, is_active, created_at, updated_at
          FROM recipient_groups
          ${whereFragment}
          ORDER BY updated_at DESC
          LIMIT ${limit} OFFSET ${offset}`,
    );
    rows = rowsRes?.rows ?? rowsRes ?? [];

    const countRes: any = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM recipient_groups ${whereFragment}`,
    );
    total = ((countRes?.rows ?? countRes)[0] ?? {}).n ?? 0;
  } catch (err: any) {
    return jsonError("select_list", err);
  }

  /* memberCount 보조 계산 — 실패해도 빈 값으로 응답 */
  const enriched = await Promise.all(
    rows.map(async (r: any) => {
      let memberCount: number | null = null;
      let criteriaSummary = "";
      try {
        const criteria = r.criteria as RecipientCriteria;
        criteriaSummary = summarizeCriteria(criteria);
        const result = await resolveRecipients(criteria, { countOnly: true });
        memberCount = result.count;
      } catch (err) {
        console.warn("[recipient-groups-list] count 실패 id=" + r.id, err);
      }
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        criteriaSummary,
        memberCount,
        isActive: r.is_active,
        createdAt: isoUTC(r.created_at),
        updatedAt: isoUTC(r.updated_at),
      };
    }),
  );

  return new Response(JSON.stringify({ ok: true, rows: enriched, total }), {
    status: 200,
    headers: JSON_HEADER,
  });
}
