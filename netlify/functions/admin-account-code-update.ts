import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ACCOUNT_CATEGORIES, accountDefaults } from "../../lib/ledger-post";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-account-code-update" };

const VALID_CATEGORIES = ACCOUNT_CATEGORIES;

function jsonError(step: string, err: any, status = 500) {
  return new Response(jsonKST({
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
    return new Response(jsonKST({ ok: false, error: "Method Not Allowed" }),
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
      SELECT id, code, name, parent_code, category, is_active, sort_order,
             kind, normal_side, statement_line, nature, default_function, system_role
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

    if (!isActive && row.system_role) {
      return jsonError("validate", new Error("시스템이 쓰는 기본 계정은 사용 중지할 수 없습니다."), 400);
    }
    const defaults = accountDefaults(category)!;
    const kind = category === row.category ? row.kind : defaults.kind;
    const normalSide = body?.normalSide === "debit" || body?.normalSide === "credit"
      ? body.normalSide
      : (category === row.category ? row.normal_side : defaults.normalSide);
    const statementLine = body?.statementLine
      ? String(body.statementLine)
      : (category === row.category ? row.statement_line : defaults.statementLine);
    const nature = body?.nature !== undefined
      ? (body.nature || null)
      : (category === row.category ? row.nature : defaults.nature);
    const defaultFunction = body?.defaultFunction !== undefined
      ? (body.defaultFunction || null)
      : (category === row.category ? row.default_function : defaults.defaultFunction);

    /* 이미 장부에 쓰인 계정은 구분과 잔액 방향을 바꾸면 과거 숫자가 달라진다 */
    if (kind !== row.kind || normalSide !== row.normal_side) {
      const used: any = await db.execute(sql`SELECT 1 FROM voucher_lines WHERE account_code = ${row.code} LIMIT 1`);
      if ((used?.rows ?? used ?? []).length > 0) {
        return jsonError("validate", new Error("장부에 쓰인 계정은 구분과 잔액 방향을 바꿀 수 없습니다."), 400);
      }
    }

    const upd: any = await db.execute(sql`
      UPDATE account_codes SET
        name = ${name}, parent_code = ${parentCode},
        category = ${category}, is_active = ${isActive},
        kind = ${kind}, normal_side = ${normalSide}, statement_line = ${statementLine},
        nature = ${nature}, default_function = ${defaultFunction}
      WHERE id = ${id}
      RETURNING id, code, name, parent_code, category, is_active, sort_order`);
    const updated = (upd?.rows ?? upd ?? [])[0];

    return new Response(jsonKST({
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
