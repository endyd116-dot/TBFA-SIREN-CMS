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

    /* ★ 2026-05-16: 카카오 알림톡 필드 3종이 DB에 있을 때만 SELECT.
       마이그(/api/migrate-add-alimtalk-fields?run=1) 호출 전엔 없으므로 조건부 SELECT. */
    const alimtalkCheck: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'communication_templates'
         AND column_name IN ('alimtalk_template_code','alimtalk_review_status','alimtalk_button_json')
    `);
    const hasAlimtalkFields = (((alimtalkCheck?.rows ?? alimtalkCheck)[0] ?? {}).n ?? 0) === 3;

    const alimtalkCols = hasAlimtalkFields
      ? sql`, alimtalk_template_code, alimtalk_review_status, alimtalk_button_json`
      : sql``;

    /* ★ 2026-05-17: images jsonb 컬럼 존재 시 SELECT (마이그 후) */
    const imgCheck: any = await db.execute(sql`
      SELECT 1 AS ok FROM information_schema.columns
       WHERE table_name = 'communication_templates' AND column_name = 'images' LIMIT 1
    `);
    const hasImagesCol = ((imgCheck?.rows ?? imgCheck ?? [])[0] || {}).ok === 1;
    const imagesCol = hasImagesCol ? sql`, images` : sql``;

    /* ★ 2026-05-17: use_siren_layout 컬럼 조건부 */
    const sirenCheck: any = await db.execute(sql`
      SELECT 1 AS ok FROM information_schema.columns
       WHERE table_name = 'communication_templates' AND column_name = 'use_siren_layout' LIMIT 1
    `);
    const hasSirenCol = ((sirenCheck?.rows ?? sirenCheck ?? [])[0] || {}).ok === 1;
    const sirenCol = hasSirenCol ? sql`, use_siren_layout` : sql``;

    const rowsRes: any = await db.execute(
      sql`SELECT id, name, channel, category, subject, body_template, variables, is_active, created_at, updated_at${alimtalkCols}${imagesCol}${sirenCol}
          FROM communication_templates
          ${whereFragment}
          ORDER BY updated_at DESC
          LIMIT ${limit} OFFSET ${offset}`
    );

    const countRes: any = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM communication_templates ${whereFragment}`
    );

    const rows = (rowsRes?.rows ?? rowsRes ?? []).map((r: any) => ({
      id:           r.id,
      name:         r.name,
      channel:      r.channel,
      category:     r.category,
      subject:      r.subject ?? null,
      bodyTemplate: r.body_template ?? "",
      variables:    r.variables ?? [],
      isActive:     r.is_active,
      createdAt:    r.created_at,
      updatedAt:    r.updated_at,
      /* 카카오 알림톡 전용 필드 — 마이그 적용 후에만 값 존재 */
      alimtalkTemplateCode: r.alimtalk_template_code ?? null,
      alimtalkReviewStatus: r.alimtalk_review_status ?? null,
      alimtalkButtonJson:   r.alimtalk_button_json ?? null,
      isKakaoOnly:          !!(r.alimtalk_template_code),
      /* ★ 2026-05-17: 이미지 첨부 — 마이그 후에만 값 존재 */
      images:               Array.isArray(r.images) ? r.images : [],
      useSirenLayout:       !!r.use_siren_layout,
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
