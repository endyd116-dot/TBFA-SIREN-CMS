import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-account-codes-list" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const category  = url.searchParams.get("category") || "";
  const activeOnly = url.searchParams.get("activeOnly") !== "false";

  try {
    const rows: any = await db.execute(sql`
      SELECT id, code, name, parent_code, category, is_active, sort_order
      FROM account_codes
      WHERE (${activeOnly} = FALSE OR is_active = TRUE)
        AND (${category} = '' OR category = ${category})
      ORDER BY sort_order, code
    `);
    const codes = (rows?.rows ?? rows ?? []).map((r: any) => ({
      id:         Number(r.id),
      code:       r.code,
      name:       r.name,
      parentCode: r.parent_code,
      category:   r.category,
      isActive:   r.is_active,
      sortOrder:  Number(r.sort_order),
    }));

    /* 장부 컬럼은 보조 조회로 합친다 */
    try {
      const extra: any = await db.execute(sql`
        SELECT a.code, a.kind, a.normal_side, a.statement_line, a.nature, a.default_function, a.system_role,
               EXISTS (SELECT 1 FROM account_codes c WHERE c.parent_code = a.code) AS has_children
          FROM account_codes a`);
      const byCode = new Map((extra?.rows ?? extra ?? []).map((r: any) => [r.code, r]));
      for (const c of codes as any[]) {
        const r: any = byCode.get(c.code);
        if (!r) continue;
        c.kind = r.kind;
        c.normalSide = r.normal_side;
        c.statementLine = r.statement_line;
        c.nature = r.nature;
        c.defaultFunction = r.default_function;
        c.systemRole = r.system_role;
        c.hasChildren = r.has_children === true;
      }
    } catch (err: any) {
      console.warn("[account-codes-list] 장부 컬럼 조회 실패 (기본값으로 계속):", err?.message);
    }

    return new Response(
      jsonKST({ ok: true, data: { codes, total: codes.length } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "계정과목 목록 조회 실패", step: "select",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
