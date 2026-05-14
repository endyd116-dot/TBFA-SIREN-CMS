import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-revenue-category-create" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "매출 카테고리 추가 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * 매출 카테고리 추가 — 대분류(parentId 없음) 또는 소분류(parentId = 대분류 id).
 * 계층은 2단계로 제한 — parentId 는 반드시 대분류여야 함(소분류의 소분류 불가).
 */
export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return jsonError("parse_body", err, 400);
  }

  const code        = String(body?.code || "").trim();
  const name        = String(body?.name || "").trim();
  const description = body?.description ? String(body.description).trim() : null;
  const parentId    = body?.parentId ? Number(body.parentId) : null;
  const sortOrder   = Number.isFinite(Number(body?.sortOrder)) ? Number(body.sortOrder) : 999;

  // ── 검증 ──────────────────────────────────────────────
  if (!code || !/^[a-zA-Z0-9_]{2,32}$/.test(code)) {
    return jsonError("validate", new Error("코드는 2~32자의 영문·숫자·밑줄만 가능합니다."), 400);
  }
  if (!name) {
    return jsonError("validate", new Error("카테고리명을 입력하세요."), 400);
  }
  if (parentId !== null && (!Number.isInteger(parentId) || parentId <= 0)) {
    return jsonError("validate", new Error("상위 분류 id가 올바르지 않습니다."), 400);
  }

  try {
    // 코드 중복 체크
    const dup: any = await db.execute(sql`SELECT id FROM revenue_categories WHERE code = ${code} LIMIT 1`);
    if ((dup?.rows ?? dup ?? []).length > 0) {
      return jsonError("duplicate", new Error(`이미 존재하는 코드입니다: ${code}`), 409);
    }
    // parentId 가 있으면 — 실존 + 대분류(parent_id IS NULL)인지 확인 (2단계 제한)
    if (parentId !== null) {
      const pa: any = await db.execute(sql`
        SELECT id, parent_id FROM revenue_categories WHERE id = ${parentId} LIMIT 1`);
      const parent = (pa?.rows ?? pa ?? [])[0];
      if (!parent) {
        return jsonError("validate", new Error("상위 분류가 존재하지 않습니다."), 400);
      }
      if (parent.parent_id != null) {
        return jsonError("validate", new Error("소분류 아래에 다시 분류를 만들 수 없습니다 (2단계까지)."), 400);
      }
    }

    const ins: any = await db.execute(sql`
      INSERT INTO revenue_categories (code, name, description, parent_id, is_system, sort_order, is_active)
      VALUES (${code}, ${name}, ${description}, ${parentId}, FALSE, ${sortOrder}, TRUE)
      RETURNING id, code, name, description, parent_id, is_system, sort_order, is_active`);
    const row = (ins?.rows ?? ins ?? [])[0];

    return new Response(JSON.stringify({
      ok: true,
      data: {
        id: Number(row.id), code: row.code, name: row.name, description: row.description,
        parentId: row.parent_id != null ? Number(row.parent_id) : null,
        isSystem: row.is_system === true,
        sortOrder: Number(row.sort_order), isActive: row.is_active,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return jsonError("insert", err);
  }
}
