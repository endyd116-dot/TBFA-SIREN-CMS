/**
 * GET /api/admin-ledger-tags
 * 결재 기안·지출 입력 창이 쓰는 활동·사업·재원·비용 계정 목록.
 * 기안은 직원도 올리므로 재정 조회 권한을 요구하지 않는다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { LEDGER_FUNCTIONS } from "../../lib/ledger-post";

export const config = { path: "/api/admin-ledger-tags" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "GET 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let step = "programs";
  try {
    const programs = rowsOf(await db.execute(sql`
      SELECT id, name, charter_ref FROM ledger_programs WHERE is_active = TRUE ORDER BY sort_order, code`))
      .map((r: any) => ({ id: Number(r.id), name: r.name, charterRef: r.charter_ref }));

    step = "funds";
    const funds = rowsOf(await db.execute(sql`
      SELECT id, name FROM ledger_funds WHERE is_active = TRUE ORDER BY sort_order, code`))
      .map((r: any) => ({ id: Number(r.id), name: r.name }));

    step = "accounts";
    const accounts = rowsOf(await db.execute(sql`
      SELECT a.code, a.name, a.parent_code, a.nature, a.default_function, a.kind, a.system_role,
             p.name AS parent_name
        FROM account_codes a
        LEFT JOIN account_codes p ON p.code = a.parent_code
       WHERE a.is_active = TRUE
         AND NOT EXISTS (SELECT 1 FROM account_codes c WHERE c.parent_code = a.code)
         AND (a.kind = 'expense' OR a.parent_code = '101' OR a.system_role = 'payable_default')
       ORDER BY a.code`)).map((r: any) => ({
      code: r.code, name: r.name, parentName: r.parent_name, nature: r.nature,
      defaultFunction: r.default_function, kind: r.kind, systemRole: r.system_role,
    }));

    return new Response(jsonKST({ ok: true, data: { functions: LEDGER_FUNCTIONS, programs, funds, accounts } }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "장부 항목 조회 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
