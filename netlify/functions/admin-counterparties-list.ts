/**
 * GET /api/admin-counterparties-list
 * 거래처 마스터 목록
 *
 * Query: ?matchType=...  default_match_type 필터 (선택)
 *        ?q=...          이름·계좌번호 검색 (선택)
 *        ?page=1&limit=50
 */
import { isoUTC } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-counterparties-list" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "거래처 목록 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const matchType = url.searchParams.get("matchType");
  const q = url.searchParams.get("q");
  const page  = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
  const offset = (page - 1) * limit;
  const like = q ? `%${q}%` : null;

  try {
    const r: any = await db.execute(sql`
      SELECT cp.id, cp.name, cp.account_no, cp.bank_name,
             cp.default_match_type, cp.default_account_code, cp.default_budget_line_id,
             cp.txn_count, cp.note, cp.learned_by, cp.created_at, cp.updated_at,
             ac.name AS account_name
      FROM counterparties cp
      LEFT JOIN account_codes ac ON ac.code = cp.default_account_code
      WHERE 1=1
        ${matchType ? sql`AND cp.default_match_type = ${matchType}` : sql``}
        ${like ? sql`AND (cp.name ILIKE ${like} OR cp.account_no ILIKE ${like})` : sql``}
      ORDER BY cp.txn_count DESC, cp.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}`);
    const rows = r?.rows ?? r ?? [];

    let total = 0;
    try {
      const c: any = await db.execute(sql`
        SELECT COUNT(*) AS n FROM counterparties cp
        WHERE 1=1
          ${matchType ? sql`AND cp.default_match_type = ${matchType}` : sql``}
          ${like ? sql`AND (cp.name ILIKE ${like} OR cp.account_no ILIKE ${like})` : sql``}`);
      total = Number((c?.rows ?? c ?? [])[0]?.n ?? 0);
    } catch { /* total 보조 */ }

    return new Response(JSON.stringify({
      ok: true,
      data: {
        counterparties: rows.map((x: any) => ({
          id: Number(x.id),
          name: x.name,
          accountNo: x.account_no,
          bankName: x.bank_name,
          defaultMatchType: x.default_match_type,
          defaultAccountCode: x.default_account_code,
          defaultAccountName: x.account_name,
          defaultBudgetLineId: x.default_budget_line_id ? Number(x.default_budget_line_id) : null,
          txnCount: Number(x.txn_count),
          note: x.note,
          learnedBy: x.learned_by ? Number(x.learned_by) : null,
          createdAt: isoUTC(x.created_at),
          updatedAt: isoUTC(x.updated_at),
        })),
        page, limit, total,
      },
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("select", err);
  }
}
