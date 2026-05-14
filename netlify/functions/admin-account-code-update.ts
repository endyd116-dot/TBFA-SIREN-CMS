import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-account-code-update" };

const VALID_CATEGORIES = ["personnel", "program", "admin_ops", "fundraising", "income"];

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "계정과목 수정 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * 계정과목 수정 — 이름·상위코드·분류·활성여부 변경.
 * code(코드 자체)는 전표·거래처가 참조하는 안정 식별자라 변경 불가.
 * is_active=false 가 '삭제' 대신 — 이미 전표에 쓰인 코드를 보호.
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

  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("validate", new Error("유효한 id가 필요합니다."), 400);
  }

  try {
    const cur: any = await db.execute(sql`
      SELECT id, code, name, parent_code, category, is_active, sort_order
      FROM account_codes WHERE id = ${id} LIMIT 1`);
    const row = (cur?.rows ?? cur ?? [])[0];
    if (!row) {
      return jsonError("not_found", new Error("계정과목을 찾을 수 없습니다."), 404);
    }

    // 부분 수정 — 전달된 필드만 갱신
    const name       = body?.name !== undefined ? String(body.name).trim() : row.name;
    const category   = body?.category !== undefined ? String(body.category).trim() : row.category;
    const parentCode = body?.parentCode !== undefined
      ? (body.parentCode ? String(body.parentCode).trim() : null)
      : row.parent_code;
    const isActive   = body?.isActive !== undefined ? Boolean(body.isActive) : row.is_active;

    if (!name) {
      return jsonError("validate", new Error("계정과목명을 입력하세요."), 400);
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return jsonError("validate", new Error(`분류는 ${VALID_CATEGORIES.join("/")} 중 하나여야 합니다.`), 400);
    }
    // parentCode 실존 확인 (자기 자신을 부모로 지정 금지)
    if (parentCode) {
      if (parentCode === row.code) {
        return jsonError("validate", new Error("자기 자신을 상위 코드로 지정할 수 없습니다."), 400);
      }
      const pa: any = await db.execute(sql`SELECT id FROM account_codes WHERE code = ${parentCode} LIMIT 1`);
      if ((pa?.rows ?? pa ?? []).length === 0) {
        return jsonError("validate", new Error(`상위 코드가 존재하지 않습니다: ${parentCode}`), 400);
      }
    }

    const upd: any = await db.execute(sql`
      UPDATE account_codes SET
        name = ${name}, parent_code = ${parentCode},
        category = ${category}, is_active = ${isActive}
      WHERE id = ${id}
      RETURNING id, code, name, parent_code, category, is_active, sort_order`);
    const updated = (upd?.rows ?? upd ?? [])[0];

    return new Response(JSON.stringify({
      ok: true,
      data: {
        id: Number(updated.id), code: updated.code, name: updated.name,
        parentCode: updated.parent_code, category: updated.category,
        isActive: updated.is_active, sortOrder: Number(updated.sort_order),
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return jsonError("update", err);
  }
}
