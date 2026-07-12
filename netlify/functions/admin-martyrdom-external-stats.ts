/**
 * admin-martyrdom-external-stats — R43 외부 자료 통계
 *
 * GET → { ok, pending, approved, rejected, lastCronAt }
 *
 * 권한: requireAdmin
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-martyrdom-external-stats" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "통계 조회 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "GET만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let pending = 0, approved = 0, rejected = 0;
  let lastCronAt: string | null = null;

  try {
    const r: any = await db.execute(sql`
      SELECT status, COUNT(*)::int AS n
        FROM martyrdom_external_research
       GROUP BY status
    `);
    const rows = (r?.rows ?? r ?? []) as any[];
    for (const row of rows) {
      const s = String(row.status || "");
      const n = Number(row.n) || 0;
      if (s === "pending")  pending = n;
      else if (s === "approved") approved = n;
      else if (s === "rejected") rejected = n;
      /* reviewing은 별도 통계 미노출 — pending과 합치는 게 더 직관적이나 설계서 응답 키 4개 고정 */
    }
  } catch (err: any) {
    return jsonError("count_status", err);
  }

  try {
    const r: any = await db.execute(sql`
      SELECT last_cron_at FROM martyrdom_external_settings ORDER BY id ASC LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (row?.last_cron_at) lastCronAt = new Date(row.last_cron_at).toISOString();
  } catch (err: any) {
    /* settings 없음 — null 유지 */
    console.warn(`[external-stats] last_cron_at 조회 실패: ${err?.message}`);
  }

  return new Response(jsonKST({ ok: true, pending, approved, rejected, lastCronAt }),
    { status: 200, headers: { "Content-Type": "application/json" } });
};
