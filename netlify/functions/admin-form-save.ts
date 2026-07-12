/**
 * POST /api/admin-form-save
 *
 * 폼 신규 생성·수정 통합. body.id 있으면 UPDATE, 없으면 INSERT.
 * 필드 정의는 한 번에 일괄 교체(부분 수정 X) — 빌더 UX 단순.
 *
 * body: { id?, title, slug, description?, instructions?,
 *         accessLevel, requiresAuth, isActive, isPublished,
 *         maxResponses?, allowDuplicates, closedMessage?,
 *         notifyOnSubmit, adminNotifyEmail?,
 *         fields: [{ fieldKey, type, label, placeholder?, helpText?, options?,
 *                    required, pattern?, minLength?, maxLength?,
 *                    acceptFileTypes?, maxFileSize?, sortOrder, isVisible }] }
 */

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-form-save" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

const VALID_ACCESS = new Set(["public", "members_only", "limited"]);
const VALID_TYPES = new Set(["text", "email", "tel", "number", "textarea", "select", "checkbox", "radio", "date", "file"]);

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST" && req.method !== "PATCH") {
    return new Response(jsonKST({ ok: false, error: "POST/PATCH만" }),
      { status: 405, headers: JSON_HEADER });
  }
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  const adminId = (auth as any).ctx?.admin?.uid ?? null;

  let body: any = {};
  try { body = await req.json(); } catch {
    return new Response(jsonKST({ ok: false, error: "JSON 파싱" }),
      { status: 400, headers: JSON_HEADER });
  }

  const title = String(body.title || "").trim().slice(0, 200);
  const slug  = String(body.slug || "").trim().slice(0, 100).toLowerCase();
  if (!title) return new Response(jsonKST({ ok: false, error: "title 필수" }),
    { status: 400, headers: JSON_HEADER });
  if (!/^[a-z0-9_-]+$/.test(slug)) return new Response(jsonKST({ ok: false, error: "slug는 영문/숫자/언더스코어/하이픈" }),
    { status: 400, headers: JSON_HEADER });

  const accessLevel = VALID_ACCESS.has(body.accessLevel) ? body.accessLevel : "public";
  const fields = Array.isArray(body.fields) ? body.fields : [];

  /* 필드 검증 */
  for (const f of fields) {
    if (!f.fieldKey || !/^[a-z0-9_]+$/i.test(f.fieldKey)) {
      return new Response(jsonKST({ ok: false, error: `필드 key '${f.fieldKey}' 유효하지 않음 (영문·숫자·_만)` }),
        { status: 400, headers: JSON_HEADER });
    }
    if (!VALID_TYPES.has(f.type)) {
      return new Response(jsonKST({ ok: false, error: `필드 타입 '${f.type}' 유효하지 않음` }),
        { status: 400, headers: JSON_HEADER });
    }
    if (!f.label) {
      return new Response(jsonKST({ ok: false, error: `필드 '${f.fieldKey}' 라벨 필수` }),
        { status: 400, headers: JSON_HEADER });
    }
  }

  /* fieldKey 중복 체크 */
  const keys = new Set<string>();
  for (const f of fields) {
    if (keys.has(f.fieldKey)) {
      return new Response(jsonKST({ ok: false, error: `중복 필드 key: ${f.fieldKey}` }),
        { status: 400, headers: JSON_HEADER });
    }
    keys.add(f.fieldKey);
  }

  try {
    /* slug 중복 체크 (다른 form이 같은 slug 사용 중인지) */
    const dup: any = await db.execute(sql`
      SELECT id FROM forms WHERE slug = ${slug} ${body.id ? sql`AND id != ${Number(body.id)}` : sql``} LIMIT 1
    `);
    if ((dup?.rows ?? dup ?? []).length > 0) {
      return new Response(jsonKST({ ok: false, error: "이미 사용 중인 slug입니다" }),
        { status: 409, headers: JSON_HEADER });
    }

    let formId: number;
    const isUpdate = !!body.id;

    if (isUpdate) {
      await db.execute(sql`
        UPDATE forms SET
          title             = ${title},
          slug              = ${slug},
          description       = ${body.description ?? null},
          instructions      = ${body.instructions ?? null},
          access_level      = ${accessLevel},
          requires_auth     = ${body.requiresAuth === true},
          is_active         = ${body.isActive !== false},
          is_published      = ${body.isPublished === true},
          max_responses     = ${body.maxResponses ? Number(body.maxResponses) : null},
          allow_duplicates  = ${body.allowDuplicates !== false},
          closed_message    = ${body.closedMessage ?? null},
          notify_on_submit  = ${body.notifyOnSubmit !== false},
          admin_notify_email = ${body.adminNotifyEmail ?? null},
          published_at      = ${body.isPublished === true ? sql`COALESCE(published_at, NOW())` : sql`NULL`},
          updated_at        = NOW()
        WHERE id = ${Number(body.id)}
      `);
      formId = Number(body.id);
    } else {
      const r: any = await db.execute(sql`
        INSERT INTO forms (title, slug, description, instructions, access_level, requires_auth,
          is_active, is_published, max_responses, allow_duplicates, closed_message,
          notify_on_submit, admin_notify_email, created_by, published_at)
        VALUES (${title}, ${slug}, ${body.description ?? null}, ${body.instructions ?? null},
          ${accessLevel}, ${body.requiresAuth === true},
          ${body.isActive !== false}, ${body.isPublished === true},
          ${body.maxResponses ? Number(body.maxResponses) : null}, ${body.allowDuplicates !== false}, ${body.closedMessage ?? null},
          ${body.notifyOnSubmit !== false}, ${body.adminNotifyEmail ?? null},
          ${adminId}, ${body.isPublished === true ? sql`NOW()` : null})
        RETURNING id
      `);
      formId = Number((r?.rows ?? r ?? [])[0]?.id);
    }

    /* 필드 일괄 교체 — 기존 삭제 후 재INSERT (수정 단순. 응답 데이터는 fieldKey 기준이라 OK) */
    await db.execute(sql`DELETE FROM form_fields WHERE form_id = ${formId}`);
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      await db.execute(sql`
        INSERT INTO form_fields (form_id, field_key, type, label, placeholder, help_text,
          options, required, pattern, min_length, max_length, accept_file_types, max_file_size,
          sort_order, is_visible)
        VALUES (${formId}, ${f.fieldKey}, ${f.type}, ${f.label},
          ${f.placeholder ?? null}, ${f.helpText ?? null},
          ${JSON.stringify(f.options || [])}::jsonb, ${f.required === true},
          ${f.pattern ?? null}, ${f.minLength ?? null}, ${f.maxLength ?? null},
          ${f.acceptFileTypes ?? null}, ${f.maxFileSize ?? null},
          ${f.sortOrder ?? i}, ${f.isVisible !== false})
      `);
    }

    return new Response(jsonKST({
      ok: true, formId, mode: isUpdate ? "updated" : "created",
      publicUrl: `https://tbfa.co.kr/form.html?slug=${slug}`,
    }), { status: 200, headers: JSON_HEADER });
  } catch (e: any) {
    return new Response(jsonKST({
      ok: false, error: "저장 실패", step: "save",
      detail: String(e?.message || e).slice(0, 500),
      stack: String(e?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
};
