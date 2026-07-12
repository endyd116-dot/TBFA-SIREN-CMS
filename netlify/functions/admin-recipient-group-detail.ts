// netlify/functions/admin-recipient-group-detail.ts
// Phase 10 R2 — 단일 그룹 상세 (criteria + memberCount + sampleMembers 5명)

import { isoUTC, jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  RecipientCriteria,
  resolveRecipients,
} from "../../lib/recipient-resolve";

export const config = { path: "/api/admin-recipient-group-detail" };

const JSON_HEADER = { "Content-Type": "application/json" };

function jsonError(step: string, err: any) {
  return new Response(
    jsonKST({
      ok: false,
      error: "수신자 그룹 조회 실패",
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
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response(
      jsonKST({ ok: false, error: "id가 올바르지 않습니다.", step: "validate" }),
      { status: 400, headers: JSON_HEADER },
    );
  }

  let row: any = null;
  try {
    const res: any = await db.execute(sql`
      SELECT id, name, description, criteria, is_active,
             created_by, updated_by, created_at, updated_at
      FROM recipient_groups
      WHERE id = ${id}
      LIMIT 1
    `);
    const rows = res?.rows ?? res ?? [];
    row = rows[0] ?? null;
  } catch (err: any) {
    return jsonError("select_detail", err);
  }

  if (!row) {
    return new Response(
      jsonKST({ ok: false, error: "그룹을 찾을 수 없습니다.", step: "not_found" }),
      { status: 404, headers: JSON_HEADER },
    );
  }

  /* 보조: memberCount + sampleMembers 5명 (실패해도 빈 값) */
  let memberCount: number | null = null;
  let sampleMembers: any[] = [];
  try {
    const criteria = row.criteria as RecipientCriteria;
    const result = await resolveRecipients(criteria, { limit: 5 });
    memberCount = result.count;
    sampleMembers = (result.members || []).map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
    }));
  } catch (err) {
    console.warn("[recipient-group-detail] resolve 실패", err);
  }

  return new Response(
    jsonKST({
      ok: true,
      group: {
        id: row.id,
        name: row.name,
        description: row.description,
        criteria: row.criteria,
        isActive: row.is_active,
        memberCount,
        sampleMembers,
        createdBy: row.created_by,
        updatedBy: row.updated_by,
        createdAt: isoUTC(row.created_at),
        updatedAt: isoUTC(row.updated_at),
      },
    }),
    { status: 200, headers: JSON_HEADER },
  );
}
