/**
 * GET /api/form?slug={slug}
 *
 * 응답폼 빌더 — 공개 폼 조회 (비회원도 접근 가능).
 *
 * 응답:
 *   { ok, form: { id, title, description, instructions, accessLevel, requiresAuth,
 *                 isClosed, closedMessage, fields: [{id, fieldKey, type, label, ...}] } }
 *   { ok: false, error }  (없음·비공개·비활성·정원 초과)
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";

export const config = { path: "/api/form" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "GET만 허용" }),
      { status: 405, headers: JSON_HEADER });
  }

  const url = new URL(req.url);
  const slug = String(url.searchParams.get("slug") || "").trim();
  if (!slug) {
    return new Response(JSON.stringify({ ok: false, error: "slug 필수" }),
      { status: 400, headers: JSON_HEADER });
  }

  try {
    /* 폼 마스터 + 응답 카운트 */
    const r: any = await db.execute(sql`
      SELECT f.id, f.title, f.slug, f.description, f.instructions,
             f.access_level, f.requires_auth, f.is_active, f.is_published,
             f.max_responses, f.allow_duplicates, f.closed_message,
             COALESCE((SELECT COUNT(*)::int FROM form_submissions s WHERE s.form_id = f.id), 0) AS response_count
        FROM forms f
       WHERE f.slug = ${slug}
       LIMIT 1
    `);
    const form = (r?.rows ?? r ?? [])[0];
    if (!form) {
      return new Response(JSON.stringify({ ok: false, error: "존재하지 않는 폼" }),
        { status: 404, headers: JSON_HEADER });
    }

    if (!form.is_active || !form.is_published) {
      return new Response(JSON.stringify({ ok: false, error: "현재 응답을 받지 않는 폼입니다", isClosed: true }),
        { status: 410, headers: JSON_HEADER });
    }

    /* 정원 초과 */
    const isClosed = form.max_responses != null && Number(form.response_count) >= Number(form.max_responses);

    /* 필드 정의 */
    const fr: any = await db.execute(sql`
      SELECT id, field_key, type, label, placeholder, help_text, options, required,
             pattern, min_length, max_length, accept_file_types, max_file_size,
             sort_order, is_visible, show_conditions
        FROM form_fields
       WHERE form_id = ${Number(form.id)} AND is_visible = TRUE
       ORDER BY sort_order ASC, id ASC
    `);
    const fields = (fr?.rows ?? fr ?? []).map((f: any) => ({
      id:              Number(f.id),
      fieldKey:        f.field_key,
      type:            f.type,
      label:           f.label,
      placeholder:     f.placeholder,
      helpText:        f.help_text,
      options:         f.options || [],
      required:        f.required,
      pattern:         f.pattern,
      minLength:       f.min_length,
      maxLength:       f.max_length,
      acceptFileTypes: f.accept_file_types,
      maxFileSize:     f.max_file_size,
      showConditions:  f.show_conditions,
    }));

    return new Response(JSON.stringify({
      ok: true,
      form: {
        id:            Number(form.id),
        title:         form.title,
        slug:          form.slug,
        description:   form.description,
        instructions:  form.instructions,
        accessLevel:   form.access_level,
        requiresAuth:  form.requires_auth,
        responseCount: Number(form.response_count),
        maxResponses:  form.max_responses,
        isClosed,
        closedMessage: isClosed ? (form.closed_message || "응답 정원이 마감되었습니다") : null,
        fields,
      },
    }, null, 2), { status: 200, headers: JSON_HEADER });
  } catch (e: any) {
    return new Response(JSON.stringify({
      ok: false, error: "조회 실패", detail: String(e?.message || e).slice(0, 300),
    }), { status: 500, headers: JSON_HEADER });
  }
};
