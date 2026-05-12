/**
 * POST /api/admin/prospect-donor-create
 *
 * 예비 후원자 신규 등록 — members 테이블에 INSERT.
 *  - donor_type = 'prospect'
 *  - prospect_subtype = 'onetime' (기본)
 *  - 캠페인·이벤트 구분: prospect_event_name, prospect_entry_path
 *
 * 잠재 후원자(potential_donors)와 다른 점: 정식 회원 테이블에 들어감.
 *
 * Body:
 *   { name (필수), email?, phone?, eventName?, entryPath?, memo? }
 *
 * Response: { ok, id, message }
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin/prospect-donor-create" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "예비 후원자 등록 실패", step,
    detail: String(err?.message || err).slice(0, 500),
  }), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
      status: 405, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  let body: any = {};
  try { body = await req.json(); } catch { return jsonError("parse", "JSON 파싱 실패", 400); }

  const name = String(body?.name || "").trim();
  if (!name) return jsonError("validate", "이름은 필수입니다", 400);

  const email     = body?.email ? String(body.email).trim().slice(0, 200) : null;
  const phone     = body?.phone ? String(body.phone).trim().slice(0, 30) : null;
  const eventName = body?.eventName ? String(body.eventName).trim().slice(0, 150) : null;
  const entryPath = body?.entryPath ? String(body.entryPath).trim().slice(0, 50) : null;
  const memo      = body?.memo ? String(body.memo).trim().slice(0, 500) : null;

  /* 중복 회원 체크 (이메일 또는 전화) */
  if (email || phone) {
    try {
      const dupRes: any = await db.execute(sql`
        SELECT id, name FROM members
        WHERE (${email}::text IS NOT NULL AND email = ${email})
           OR (${phone}::text IS NOT NULL AND phone = ${phone})
        LIMIT 1
      `);
      const dup = (Array.isArray(dupRes) ? dupRes[0] : (dupRes as any).rows?.[0]);
      if (dup) {
        return new Response(JSON.stringify({
          ok: false, error: `이미 회원으로 등록되어 있습니다 (#${dup.id} ${dup.name})`,
          step: "duplicate", duplicateMemberId: dup.id,
        }), { status: 409, headers: { "Content-Type": "application/json; charset=utf-8" } });
      }
    } catch (_e) { /* 중복 검사 실패는 무시하고 계속 */ }
  }

  /* INSERT — members 테이블 (prospect_event_name 컬럼 없으면 폴백) */
  let newId = 0;
  try {
    const r: any = await db.execute(sql`
      INSERT INTO members (
        name, email, phone, type, status,
        donor_type, prospect_subtype,
        prospect_event_name, prospect_entry_path,
        donor_evaluated_at,
        created_at, updated_at
      ) VALUES (
        ${name}, ${email}, ${phone}, 'regular', 'active',
        'prospect', 'onetime',
        ${eventName}, ${entryPath},
        NOW(),
        NOW(), NOW()
      )
      RETURNING id
    `);
    const row = (r?.rows ?? r ?? [])[0];
    newId = Number(row?.id) || 0;
  } catch (err: any) {
    /* 컬럼 미존재(마이그레이션 전)면 폴백 INSERT */
    if (String(err?.message || "").includes("prospect_event_name") || String(err?.message || "").includes("prospect_entry_path")) {
      try {
        const r2: any = await db.execute(sql`
          INSERT INTO members (
            name, email, phone, type, status,
            donor_type, prospect_subtype,
            donor_evaluated_at,
            created_at, updated_at
          ) VALUES (
            ${name}, ${email}, ${phone}, 'regular', 'active',
            'prospect', 'onetime',
            NOW(),
            NOW(), NOW()
          )
          RETURNING id
        `);
        const row = (r2?.rows ?? r2 ?? [])[0];
        newId = Number(row?.id) || 0;
      } catch (err2: any) { return jsonError("insert_fallback", err2); }
    } else {
      return jsonError("insert", err);
    }
  }

  /* memo가 있으면 별도 컬럼이 없으므로 audit_logs에 기록 (선택) */

  return new Response(JSON.stringify({
    ok: true, id: newId, message: "예비 후원자로 등록되었습니다",
  }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
};
