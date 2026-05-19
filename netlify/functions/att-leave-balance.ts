/**
 * GET /api/att-leave-balance?year=2026
 * 본인의 연도별 휴가 잔여 — 직원 휴가 탭 표.
 * 응답: { ok:true, data: [{ leaveTypeId, name, granted, used, remaining, unit, isPaid }] }
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/att-leave-balance" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "휴가 잔여 조회 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return jsonError("validate", new Error("year 형식 오류"), 400);
  }

  const memberUid = String(auth.ctx.member.id);

  try {
    // 활성 휴가 종류 전체와 LEFT JOIN — 잔액 없는 종류도 0/0/0 으로 표시
    const result = await db.execute(sql`
      SELECT
        lt.id                            AS leave_type_id,
        lt.name                          AS name,
        lt.is_paid                       AS is_paid,
        lt.unit                          AS unit,
        lt.display_order                 AS display_order,
        COALESCE(b.total_days, 0)        AS granted,
        COALESCE(b.used_days, 0)         AS used,
        COALESCE(b.total_days - b.used_days, 0) AS remaining
      FROM att_leave_types lt
      LEFT JOIN att_leave_balances b
        ON b.leave_type_id = lt.id
       AND b.member_uid    = ${memberUid}
       AND b.year          = ${year}
      WHERE lt.is_active = true
      ORDER BY lt.display_order, lt.id
    `);

    const rows = (result.rows as any[]).map(r => ({
      leaveTypeId: Number(r.leave_type_id),
      name:        r.name,
      isPaid:      r.is_paid,
      unit:        r.unit,
      granted:     Number(r.granted),
      used:        Number(r.used),
      remaining:   Number(r.remaining),
    }));

    return jsonOk(rows);
  } catch (err) {
    return jsonError("select_balance", err);
  }
}
