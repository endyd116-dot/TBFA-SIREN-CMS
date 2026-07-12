/**
 * GET /api/admin-forms-list                — 폼 목록
 * GET /api/admin-forms-list?id={id}        — 단건 + 필드 정의 + 응답 카운트
 */

import { isoUTC, jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-forms-list" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "GET만" }),
      { status: 405, headers: JSON_HEADER });
  }
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  try {
    if (id) {
      /* 단건 + 필드 */
      const fr: any = await db.execute(sql`
        SELECT f.*, COALESCE((SELECT COUNT(*)::int FROM form_submissions s WHERE s.form_id = f.id), 0) AS response_count
          FROM forms f WHERE f.id = ${Number(id)} LIMIT 1
      `);
      const form = (fr?.rows ?? fr ?? [])[0];
      if (!form) return new Response(jsonKST({ ok: false, error: "없음" }),
        { status: 404, headers: JSON_HEADER });

      const ffr: any = await db.execute(sql`
        SELECT * FROM form_fields WHERE form_id = ${Number(id)} ORDER BY sort_order ASC, id ASC
      `);
      const fields = (ffr?.rows ?? ffr ?? []).map((r: any) => ({
        id: Number(r.id), fieldKey: r.field_key, type: r.type, label: r.label,
        placeholder: r.placeholder, helpText: r.help_text, options: r.options || [],
        required: r.required, pattern: r.pattern,
        minLength: r.min_length, maxLength: r.max_length,
        acceptFileTypes: r.accept_file_types, maxFileSize: r.max_file_size,
        sortOrder: r.sort_order, isVisible: r.is_visible,
      }));

      return new Response(jsonKST({
        ok: true, form: {
          id: Number(form.id), title: form.title, slug: form.slug,
          description: form.description, instructions: form.instructions,
          accessLevel: form.access_level, requiresAuth: form.requires_auth,
          isActive: form.is_active, isPublished: form.is_published,
          maxResponses: form.max_responses, allowDuplicates: form.allow_duplicates,
          closedMessage: form.closed_message,
          notifyOnSubmit: form.notify_on_submit, adminNotifyEmail: form.admin_notify_email,
          responseCount: Number(form.response_count),
          createdAt: isoUTC(form.created_at), publishedAt: isoUTC(form.published_at),
          fields,
        },
      }, null, 2), { status: 200, headers: JSON_HEADER });
    }

    /* 목록 */
    const r: any = await db.execute(sql`
      SELECT f.id, f.title, f.slug, f.access_level, f.is_active, f.is_published,
             f.max_responses, f.created_at, f.published_at,
             COALESCE((SELECT COUNT(*)::int FROM form_submissions s WHERE s.form_id = f.id), 0) AS response_count,
             COALESCE((SELECT COUNT(*)::int FROM form_fields ff WHERE ff.form_id = f.id), 0) AS field_count
        FROM forms f ORDER BY f.created_at DESC LIMIT 200
    `);
    const rows = (r?.rows ?? r ?? []).map((f: any) => ({
      id: Number(f.id), title: f.title, slug: f.slug,
      accessLevel: f.access_level, isActive: f.is_active, isPublished: f.is_published,
      maxResponses: f.max_responses, responseCount: Number(f.response_count),
      fieldCount: Number(f.field_count), createdAt: isoUTC(f.created_at), publishedAt: isoUTC(f.published_at),
    }));
    return new Response(jsonKST({ ok: true, forms: rows }, null, 2),
      { status: 200, headers: JSON_HEADER });
  } catch (e: any) {
    return new Response(jsonKST({
      ok: false, error: "조회 실패", detail: String(e?.message || e).slice(0, 300),
    }), { status: 500, headers: JSON_HEADER });
  }
};
