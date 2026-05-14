import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-account-code-create" };

const VALID_CATEGORIES = ["personnel", "program", "admin_ops", "fundraising", "income"];

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "계정과목 추가 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

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

  const code       = String(body?.code || "").trim();
  const name       = String(body?.name || "").trim();
  const category   = String(body?.category || "").trim();
  const parentCode = body?.parentCode ? String(body.parentCode).trim() : null;
  const sortOrder  = Number.isFinite(Number(body?.sortOrder)) ? Number(body.sortOrder) : 999;

  // ── 검증 ──────────────────────────────────────────────
  if (!code || !/^[0-9]{2,20}$/.test(code)) {
    return jsonError("validate", new Error("코드는 2~20자리 숫자여야 합니다."), 400);
  }
  if (!name) {
    return jsonError("validate", new Error("계정과목명을 입력하세요."), 400);
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return jsonError("validate", new Error(`분류는 ${VALID_CATEGORIES.join("/")} 중 하나여야 합니다.`), 400);
  }

  try {
    // 코드 중복 체크
    const dup: any = await db.execute(sql`SELECT id FROM account_codes WHERE code = ${code} LIMIT 1`);
    if ((dup?.rows ?? dup ?? []).length > 0) {
      return jsonError("duplicate", new Error(`이미 존재하는 코드입니다: ${code}`), 409);
    }
    // parentCode 가 있으면 실존 확인
    if (parentCode) {
      const pa: any = await db.execute(sql`SELECT id FROM account_codes WHERE code = ${parentCode} LIMIT 1`);
      if ((pa?.rows ?? pa ?? []).length === 0) {
        return jsonError("validate", new Error(`상위 코드가 존재하지 않습니다: ${parentCode}`), 400);
      }
    }

    const ins: any = await db.execute(sql`
      INSERT INTO account_codes (code, name, parent_code, category, is_active, sort_order)
      VALUES (${code}, ${name}, ${parentCode}, ${category}, TRUE, ${sortOrder})
      RETURNING id, code, name, parent_code, category, is_active, sort_order`);
    const row = (ins?.rows ?? ins ?? [])[0];

    return new Response(JSON.stringify({
      ok: true,
      data: {
        id: Number(row.id), code: row.code, name: row.name,
        parentCode: row.parent_code, category: row.category,
        isActive: row.is_active, sortOrder: Number(row.sort_order),
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return jsonError("insert", err);
  }
}
