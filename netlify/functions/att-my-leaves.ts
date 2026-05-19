import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/att-my-leaves" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "잔여 휴가 조회 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const memberUid: string = String(auth.ctx.member.id);

  const year = new Date().getFullYear();

  try {
    const result = await db.execute(sql`
      SELECT
        b.id,
        b.leave_type_id,
        b.year,
        b.total_days,
        b.used_days,
        (b.total_days - b.used_days) AS remaining_days,
        lt.name AS leave_type_name,
        lt.is_paid,
        lt.unit,
        lt.display_order
      FROM att_leave_balances b
      JOIN att_leave_types lt ON lt.id = b.leave_type_id
      WHERE b.member_uid = ${memberUid}
        AND b.year = ${year}
        AND lt.is_active = true
      ORDER BY lt.display_order, lt.id
    `);
    return jsonOk({ year, memberUid, balances: result.rows });
  } catch (err) {
    return jsonError("select_balances", err);
  }
}
