import { db } from "../../db/index";
import { attLeaveBalances, attLeaveTypes } from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-att-leave-balances" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "잔여 휴가 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  if (auth.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const method = req.method;
  const url = new URL(req.url);

  // GET — 전체 직원 잔여 목록 (?year=)
  if (method === "GET") {
    const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());
    try {
      const rows = await db.execute(sql`
        SELECT
          b.id,
          b.member_uid,
          b.leave_type_id,
          b.year,
          b.total_days,
          b.used_days,
          (b.total_days - b.used_days) AS remaining_days,
          lt.name AS leave_type_name,
          lt.unit
        FROM att_leave_balances b
        JOIN att_leave_types lt ON lt.id = b.leave_type_id
        WHERE b.year = ${year}
        ORDER BY b.member_uid, lt.display_order, lt.id
      `);
      return jsonOk(rows.rows);
    } catch (err) {
      return jsonError("select_balances", err);
    }
  }

  // PUT — 수동 조정 { memberUid, leaveTypeId, year, totalDays }
  if (method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { memberUid, leaveTypeId, year, totalDays } = body;
    if (!memberUid || !leaveTypeId || !year || totalDays == null) {
      return jsonError("validate", new Error("memberUid, leaveTypeId, year, totalDays 필수"), 400);
    }

    try {
      // upsert — 없으면 생성, 있으면 total_days만 업데이트
      const [row] = await db
        .insert(attLeaveBalances)
        .values({
          memberUid,
          leaveTypeId,
          year,
          totalDays: String(totalDays),
          usedDays: "0",
        })
        .onConflictDoUpdate({
          target: [attLeaveBalances.memberUid, attLeaveBalances.leaveTypeId, attLeaveBalances.year],
          set: { totalDays: String(totalDays) },
        })
        .returning();
      return jsonOk(row);
    } catch (err) {
      return jsonError("upsert_balance", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
