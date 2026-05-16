/**
 * GET /api/admin-form-submissions-list?formId={id}&limit=200
 * 응답 목록 + 필드 정의 (CSV·통계용)
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-form-submissions-list" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") return new Response(JSON.stringify({ ok: false, error: "GET만" }),
    { status: 405, headers: JSON_HEADER });
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const url = new URL(req.url);
  const formId = Number(url.searchParams.get("formId") || 0);
  const limit = Math.min(Number(url.searchParams.get("limit") || 200), 1000);
  if (!formId) return new Response(JSON.stringify({ ok: false, error: "formId 필수" }),
    { status: 400, headers: JSON_HEADER });

  try {
    const fr: any = await db.execute(sql`
      SELECT title, slug FROM forms WHERE id = ${formId} LIMIT 1
    `);
    const form = (fr?.rows ?? fr ?? [])[0];
    if (!form) return new Response(JSON.stringify({ ok: false, error: "폼 없음" }),
      { status: 404, headers: JSON_HEADER });

    const ffr: any = await db.execute(sql`
      SELECT field_key, label, type FROM form_fields
       WHERE form_id = ${formId} ORDER BY sort_order ASC, id ASC
    `);
    const fields = (ffr?.rows ?? ffr ?? []).map((r: any) => ({
      fieldKey: r.field_key, label: r.label, type: r.type,
    }));

    const sr: any = await db.execute(sql`
      SELECT s.id, s.member_id, s.member_email, s.member_phone, s.data, s.status,
             s.ip_address, s.created_at,
             m.name AS member_name
        FROM form_submissions s
        LEFT JOIN members m ON m.id = s.member_id
       WHERE s.form_id = ${formId}
       ORDER BY s.created_at DESC
       LIMIT ${limit}
    `);
    const submissions = (sr?.rows ?? sr ?? []).map((s: any) => ({
      id: Number(s.id),
      memberId: s.member_id ? Number(s.member_id) : null,
      memberName: s.member_name || null,
      memberEmail: s.member_email,
      memberPhone: s.member_phone,
      data: s.data || {},
      status: s.status,
      ipAddress: s.ip_address,
      createdAt: s.created_at,
    }));

    return new Response(JSON.stringify({
      ok: true,
      form: { id: formId, title: form.title, slug: form.slug },
      fields,
      submissions,
      total: submissions.length,
    }, null, 2), { status: 200, headers: JSON_HEADER });
  } catch (e: any) {
    return new Response(JSON.stringify({
      ok: false, error: "조회 실패", detail: String(e?.message || e).slice(0, 300),
    }), { status: 500, headers: JSON_HEADER });
  }
};
