/**
 * GET /api/att-leave-history
 * 본인의 휴가 신청 이력 (최근 30건).
 * 응답: { ok:true, data: [{ id, typeName, startDate, endDate, days, reason, status, ... }] }
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/att-leave-history" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "휴가 이력 조회 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const memberUid = String(auth.ctx.member.id);

  // R29-ATT-GAP2 PHASE D: 반차 컬럼 존재 시에만 SELECT
  let halfDayExists = false;
  try {
    const c: any = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM information_schema.columns
      WHERE table_name='att_leave_requests'
        AND column_name IN ('is_half_day','half_day_period')
    `);
    halfDayExists = Number(((c.rows ?? [])[0] ?? {}).cnt ?? 0) >= 2;
  } catch {}

  try {
    const result = await db.execute(halfDayExists ? sql`
      SELECT
        r.id, r.start_date, r.end_date, r.days, r.reason, r.status,
        r.review_note, r.created_at, r.is_half_day, r.half_day_period,
        lt.id AS leave_type_id, lt.name AS type_name
      FROM att_leave_requests r
      LEFT JOIN att_leave_types lt ON lt.id = r.leave_type_id
      WHERE r.member_uid = ${memberUid}
      ORDER BY r.created_at DESC
      LIMIT 30
    ` : sql`
      SELECT
        r.id, r.start_date, r.end_date, r.days, r.reason, r.status,
        r.review_note, r.created_at,
        FALSE AS is_half_day, NULL::varchar AS half_day_period,
        lt.id AS leave_type_id, lt.name AS type_name
      FROM att_leave_requests r
      LEFT JOIN att_leave_types lt ON lt.id = r.leave_type_id
      WHERE r.member_uid = ${memberUid}
      ORDER BY r.created_at DESC
      LIMIT 30
    `);

    const rows = (result.rows as any[]).map(r => ({
      id:            Number(r.id),
      leaveTypeId:   r.leave_type_id != null ? Number(r.leave_type_id) : null,
      typeName:      r.type_name,
      startDate:     r.start_date,
      endDate:       r.end_date,
      days:          r.days,
      reason:        r.reason,
      status:        r.status,
      reviewNote:    r.review_note,
      createdAt:     r.created_at,
      isHalfDay:     r.is_half_day === true,
      halfDayPeriod: r.half_day_period,
    }));

    return jsonOk(rows);
  } catch (err) {
    return jsonError("select_history", err);
  }
}
