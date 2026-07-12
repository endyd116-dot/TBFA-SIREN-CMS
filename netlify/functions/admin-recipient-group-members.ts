// netlify/functions/admin-recipient-group-members.ts
// Phase 10 R2 — 저장된 그룹의 현재 시점 회원 목록 (페이지네이션)

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  RecipientCriteria,
  resolveRecipients,
} from "../../lib/recipient-resolve";

export const config = { path: "/api/admin-recipient-group-members" };

const JSON_HEADER = { "Content-Type": "application/json" };

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

  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

  let criteria: RecipientCriteria | null = null;
  try {
    const res: any = await db.execute(
      sql`SELECT criteria FROM recipient_groups WHERE id = ${id} LIMIT 1`,
    );
    const rows = res?.rows ?? res ?? [];
    if (rows.length === 0) {
      return new Response(
        jsonKST({ ok: false, error: "그룹을 찾을 수 없습니다.", step: "not_found" }),
        { status: 404, headers: JSON_HEADER },
      );
    }
    criteria = rows[0].criteria as RecipientCriteria;
  } catch (err: any) {
    return new Response(
      jsonKST({
        ok: false, error: "그룹 조회 실패", step: "select_group",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }

  try {
    const result = await resolveRecipients(criteria as RecipientCriteria, { limit, offset });
    return new Response(
      jsonKST({
        ok: true,
        members: result.members || [],
        total: result.count,
      }),
      { status: 200, headers: JSON_HEADER },
    );
  } catch (err: any) {
    return new Response(
      jsonKST({
        ok: false, error: "회원 목록 조회 실패", step: "resolve",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }
}
