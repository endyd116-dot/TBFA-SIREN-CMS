// netlify/functions/admin-template-detail.ts
// Phase 10 R1 — 발송 템플릿 단일 상세 조회

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-template-detail" };

const JSON_HEADER = { "Content-Type": "application/json" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: "id 파라미터가 필요합니다." }), {
      status: 400,
      headers: JSON_HEADER,
    });
  }

  try {
    /* ★ 2026-05-16: 카카오 필드 조건부 SELECT (마이그 적용 후만 존재) */
    const colCheck: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'communication_templates'
         AND column_name IN ('alimtalk_template_code','alimtalk_review_status','alimtalk_button_json')
    `);
    const hasAlimtalkCols = (((colCheck?.rows ?? colCheck)[0] ?? {}).n ?? 0) === 3;
    const alimtalkCols = hasAlimtalkCols
      ? sql`, alimtalk_template_code, alimtalk_review_status, alimtalk_button_json`
      : sql``;

    const res: any = await db.execute(
      sql`SELECT id, name, channel, category, subject, body_template, variables,
                 is_active, created_by, updated_by, created_at, updated_at${alimtalkCols}
          FROM communication_templates
          WHERE id = ${id}
          LIMIT 1`
    );

    const rows = res?.rows ?? res ?? [];
    const row = rows[0];
    if (!row) {
      return new Response(JSON.stringify({ ok: false, error: "템플릿을 찾을 수 없습니다." }), {
        status: 404,
        headers: JSON_HEADER,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        template: {
          id:           row.id,
          name:         row.name,
          channel:      row.channel,
          category:     row.category,
          subject:      row.subject ?? null,
          bodyTemplate: row.body_template,
          variables:    row.variables ?? [],
          isActive:     row.is_active,
          createdBy:    row.created_by ?? null,
          updatedBy:    row.updated_by ?? null,
          createdAt:    row.created_at,
          updatedAt:    row.updated_at,
          alimtalkTemplateCode: row.alimtalk_template_code ?? null,
          alimtalkReviewStatus: row.alimtalk_review_status ?? null,
          alimtalkButtonJson:   row.alimtalk_button_json ?? null,
          isKakaoOnly:          !!(row.alimtalk_template_code),
        },
      }),
      { status: 200, headers: JSON_HEADER },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "템플릿 조회 실패",
        step: "select_detail",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }
}
