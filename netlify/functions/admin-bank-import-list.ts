/**
 * GET /api/admin-bank-import-list
 * 통장 업로드 이력 목록
 *
 * Query: ?page=1&limit=30
 */
import { isoUTC } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-bank-import-list" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "업로드 이력 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const page  = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 30, 100);
  const offset = (page - 1) * limit;

  try {
    const r: any = await db.execute(sql`
      SELECT id, filename, bank_name, period_from, period_to, total_rows,
             auto_matched, pending_review, ignored_rows, imported_by, imported_at, status
      FROM bank_imports
      ORDER BY imported_at DESC, id DESC
      LIMIT ${limit} OFFSET ${offset}`);
    const rows = r?.rows ?? r ?? [];

    let total = 0;
    try {
      const c: any = await db.execute(sql`SELECT COUNT(*) AS n FROM bank_imports`);
      total = Number((c?.rows ?? c ?? [])[0]?.n ?? 0);
    } catch { /* total은 보조 — 실패해도 계속 */ }

    return new Response(JSON.stringify({
      ok: true,
      data: {
        imports: rows.map((x: any) => ({
          id: Number(x.id),
          filename: x.filename,
          bankName: x.bank_name,
          periodFrom: x.period_from,
          periodTo: x.period_to,
          totalRows: Number(x.total_rows),
          autoMatched: Number(x.auto_matched),
          pendingReview: Number(x.pending_review),
          ignoredRows: Number(x.ignored_rows),
          importedBy: x.imported_by,
          importedAt: isoUTC(x.imported_at),
          status: x.status,
        })),
        page, limit, total,
      },
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("select", err);
  }
}
