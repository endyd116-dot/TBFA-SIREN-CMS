import { db } from "../../db/index";
import { members, attLeaveRequests, attLeaveBalances, attLeaveTypes } from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireActiveUser } from "../../lib/auth";

export const config = { path: "/api/att-leave-request" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "휴가 신청 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireActiveUser(req);
  if (!auth.ok) return auth.res;

  const method = req.method;

  let memberUid: string;
  try {
    const [member] = await db
      .select({ uid: members.uid })
      .from(members)
      .where(eq(members.id, auth.user.uid))
      .limit(1);
    if (!member) return jsonError("member_not_found", new Error("회원 없음"), 404);
    memberUid = member.uid;
  } catch (err) {
    return jsonError("select_member", err);
  }

  // GET — 본인 신청 내역
  if (method === "GET") {
    try {
      const rows = await db.execute(sql`
        SELECT
          r.*,
          lt.name AS leave_type_name
        FROM att_leave_requests r
        JOIN att_leave_types lt ON lt.id = r.leave_type_id
        WHERE r.member_uid = ${memberUid}
        ORDER BY r.created_at DESC
        LIMIT 100
      `);
      return jsonOk(rows.rows);
    } catch (err) {
      return jsonError("select_requests", err);
    }
  }

  // POST — 휴가 신청
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { leaveTypeId, startDate, endDate, days, reason } = body;
    if (!leaveTypeId || !startDate || !endDate || days == null) {
      return jsonError("validate", new Error("leaveTypeId, startDate, endDate, days 필수"), 400);
    }

    // 잔여 검증
    const year = new Date(startDate).getFullYear();
    try {
      const balRows = await db
        .select()
        .from(attLeaveBalances)
        .where(
          and(
            eq(attLeaveBalances.memberUid, memberUid),
            eq(attLeaveBalances.leaveTypeId, leaveTypeId),
            eq(attLeaveBalances.year, year)
          )
        )
        .limit(1);

      const balance = balRows[0];
      if (balance) {
        const remaining = Number(balance.totalDays) - Number(balance.usedDays);
        if (remaining < days) {
          return new Response(JSON.stringify({
            ok: false, error: `잔여 휴가 부족 (잔여: ${remaining}일, 신청: ${days}일)`, step: "balance_check",
          }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
      }
    } catch (err) {
      console.warn("[att-leave-request] 잔여 검증 실패 — 계속 진행:", err);
    }

    try {
      const [row] = await db.insert(attLeaveRequests).values({
        memberUid,
        leaveTypeId,
        startDate,
        endDate,
        days: String(days),
        reason: reason ?? null,
        status: "PENDING",
      }).returning();
      return jsonOk(row, 201);
    } catch (err) {
      return jsonError("insert_request", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
