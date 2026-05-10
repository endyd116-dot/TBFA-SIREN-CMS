// netlify/functions/admin-templates-list.ts
// Phase 10 R1 — 발송 템플릿 목록 조회 (필터·페이지네이션)

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-templates-list" };

const VALID_CHANNELS = ["email", "sms", "kakao", "inapp"];
const VALID_CATEGORIES = ["newsletter", "announcement", "auto_trigger", "campaign", "system"];

const JSON_HEADER = { "Content-Type": "application/json" };

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "템플릿 목록 조회 실패",
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
  const channel = url.searchParams.get("channel") || "";
  const category = url.searchParams.get("category") || "";
  const q = url.searchParams.get("q") || "";
  const includeInactive = url.searchParams.get("includeInactive") === "1";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

  if (channel && !VALID_CHANNELS.includes(channel)) {
    return new Response(JSON.stringify({ ok: false, error: "채널 값이 올바르지 않습니다." }), {
      status: 400,
      headers: JSON_HEADER,
    });
  }
  if (category && !VALID_CATEGORIES.includes(category)) {
    return new Response(JSON.stringify({ ok: false, error: "카테고리 값이 올바르지 않습니다." }), {
      status: 400,
      headers: JSON_HEADER,
    });
  }

  try {
    const conditions: ReturnType<typeof sql>[] = [];
    if (!includeInactive) conditions.push(sql`is_active = true`);
    if (channel)          conditions.push(sql`channel = ${channel}`);
    if (category)         conditions.push(sql`category = ${category}`);
    if (q)                conditions.push(sql`name ILIKE ${"%" + q + "%"}`);

    const whereFragment =
      conditions.length > 0
        ? sql`WHERE ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`
        : sql``;

    const rowsRes: any = await db.execute(
      sql`SELECT id, name, channel, category, subject, is_active, created_at, updated_at
          FROM communication_templates
          ${whereFragment}
          ORDER BY updated_at DESC
          LIMIT ${limit} OFFSET ${offset}`
    );

    const countRes: any = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM communication_templates ${whereFragment}`
    );

    const rows = (rowsRes?.rows ?? rowsRes ?? []).map((r: any) => ({
      id:        r.id,
      name:      r.name,
      channel:   r.channel,
      category:  r.category,
      subject:   r.subject ?? null,
      isActive:  r.is_active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    const total = ((countRes?.rows ?? countRes)[0] ?? {}).n ?? 0;

    return new Response(JSON.stringify({ ok: true, rows, total }), {
      status: 200,
      headers: JSON_HEADER,
    });
  } catch (err: any) {
    return jsonError("select_list", err);
  }
}
