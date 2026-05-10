// netlify/functions/admin-recipient-group-create.ts
// Phase 10 R2 — 신규 수신자 그룹 생성

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { validateCriteria } from "../../lib/recipient-resolve";

export const config = { path: "/api/admin-recipient-group-create" };

const JSON_HEADER = { "Content-Type": "application/json" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "요청 본문을 파싱할 수 없습니다.", step: "parse" }),
      { status: 400, headers: JSON_HEADER },
    );
  }

  /* 검증 */
  try {
    const { name, description, criteria } = body || {};
    if (!name || typeof name !== "string" || name.trim().length === 0 || name.length > 100) {
      return new Response(
        JSON.stringify({ ok: false, error: "그룹 이름을 입력해 주세요. (1~100자)", step: "validate" }),
        { status: 400, headers: JSON_HEADER },
      );
    }
    if (description != null && typeof description !== "string") {
      return new Response(
        JSON.stringify({ ok: false, error: "설명은 문자열이어야 합니다.", step: "validate" }),
        { status: 400, headers: JSON_HEADER },
      );
    }

    const v = validateCriteria(criteria);
    if (!v.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: (v as any).error, step: "validate" }),
        { status: 400, headers: JSON_HEADER },
      );
    }

    /* manual: 존재하지 않는 회원 ID 검증 */
    if (criteria.type === "manual") {
      const ids: number[] = criteria.memberIds;
      const existsRes: any = await db.execute(sql`
        SELECT id FROM members WHERE id = ANY(${ids}::int[])
      `);
      const found = new Set((existsRes?.rows ?? existsRes ?? []).map((r: any) => r.id));
      const missing = ids.filter((x: number) => !found.has(x));
      if (missing.length > 0) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: `존재하지 않는 회원 ID가 포함되어 있습니다: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? " 외" : ""}`,
            step: "validate",
            missingMemberIds: missing,
          }),
          { status: 400, headers: JSON_HEADER },
        );
      }
    }

    /* 이름 중복 검사 (is_active=true 그룹 안에서) */
    const dupRes: any = await db.execute(sql`
      SELECT id FROM recipient_groups WHERE name = ${name.trim()} AND is_active = true LIMIT 1
    `);
    const dupRows = dupRes?.rows ?? dupRes ?? [];
    if (Array.isArray(dupRows) && dupRows.length > 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "같은 이름의 활성 그룹이 이미 있습니다.", step: "validate" }),
        { status: 400, headers: JSON_HEADER },
      );
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "입력값 검증 실패", step: "validate",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }

  /* INSERT */
  try {
    const { name, description, criteria } = body;
    const adminId = (auth as any).ctx.admin.uid;

    const res: any = await db.execute(sql`
      INSERT INTO recipient_groups (name, description, criteria, created_by, updated_by)
      VALUES (
        ${name.trim()},
        ${description ? String(description).trim() : null},
        ${JSON.stringify(criteria)}::jsonb,
        ${adminId},
        ${adminId}
      )
      RETURNING id
    `);
    const rows = res?.rows ?? res ?? [];
    const id = rows[0]?.id;

    return new Response(JSON.stringify({ ok: true, id }), {
      status: 201,
      headers: JSON_HEADER,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "그룹 저장 실패", step: "insert",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: JSON_HEADER },
    );
  }
}
