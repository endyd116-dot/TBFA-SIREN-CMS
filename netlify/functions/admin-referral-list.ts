/**
 * GET /api/admin-referral-list
 * 인계 이력 목록 조회
 * 응답: { ok, total, logs: [{ id, agencyName, sourceType, sourceNo, referredAt, status, statusMemo, statusUpdatedAt }] }
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-referral-list" };

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({ ok: false, error: "인계 이력 조회 실패", step, detail: String(err?.message || err).slice(0, 500), stack: String(err?.stack || "").slice(0, 1000) }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}

export default async (req: Request, _ctx: Context) => {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const url = new URL(req.url);
  const sourceType = url.searchParams.get("sourceType") || null;
  const status = url.searchParams.get("status") || null;
  const agencyIdParam = url.searchParams.get("agencyId");
  const agencyId = agencyIdParam ? Number(agencyIdParam) : null;
  const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || "20")));
  const offset = (page - 1) * limit;
  try {
    const conditions: ReturnType<typeof sql>[] = [sql`1=1`];
    if (sourceType) conditions.push(sql`source_type = ${sourceType}`);
    if (status) conditions.push(sql`status = ${status}`);
    if (agencyId) conditions.push(sql`agency_id = ${agencyId}`);
    const whereClause = sql.join(conditions, sql` AND `);
    const [countResult, rowsResult] = await Promise.all([
      db.execute(sql`SELECT COUNT(*) AS cnt FROM referral_logs WHERE ${whereClause}`),
      db.execute(sql`SELECT id, agency_name AS "agencyName", source_type AS "sourceType", source_no AS "sourceNo", referred_at AS "referredAt", status, status_memo AS "statusMemo", status_updated_at AS "statusUpdatedAt" FROM referral_logs WHERE ${whereClause} ORDER BY referred_at DESC LIMIT ${limit} OFFSET ${offset}`),
    ]);
    const countRows = Array.isArray(countResult) ? countResult : ((countResult as any)?.rows ?? []);
    const total = parseInt(String(countRows[0]?.cnt ?? countRows[0]?.count ?? 0), 10);
    const logs = Array.isArray(rowsResult) ? rowsResult : ((rowsResult as any)?.rows ?? []);
    return new Response(JSON.stringify({ ok: true, total, logs }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) { return jsonError("select_logs", err); }
};
