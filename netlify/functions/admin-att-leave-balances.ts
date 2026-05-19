import { db } from "../../db/index";
import { attLeaveBalances, attLeaveTypes, members } from "../../db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

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
  if (guardFailed(auth)) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") {
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
      const rows: any = await db.execute(sql`
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

      const balanceRows = (rows.rows ?? []) as any[];
      // member 이름·이메일 조인
      const memberIds = Array.from(
        new Set(balanceRows.map((r: any) => Number(r.member_uid)).filter((n: number) => Number.isFinite(n) && n > 0))
      );
      let memberMap = new Map<number, { name: string; email: string }>();
      if (memberIds.length > 0) {
        try {
          const mRows = await db
            .select({ id: members.id, name: members.name, email: members.email })
            .from(members)
            .where(inArray(members.id, memberIds));
          for (const m of mRows) memberMap.set(m.id, { name: m.name, email: m.email });
        } catch (e) {
          console.warn("[admin-att-leave-balances] member 조인 실패:", e);
        }
      }

      const balances = balanceRows.map((r: any) => {
        const info = memberMap.get(Number(r.member_uid));
        return {
          id:            Number(r.id),
          memberUid:     r.member_uid,
          memberName:    info?.name ?? "—",
          memberEmail:   info?.email ?? "",
          leaveTypeId:   Number(r.leave_type_id),
          leaveTypeName: r.leave_type_name,
          unit:          r.unit,
          year:          Number(r.year),
          totalDays:     Number(r.total_days),
          usedDays:      Number(r.used_days),
          remainingDays: Number(r.remaining_days),
        };
      });
      return jsonOk(balances);
    } catch (err) {
      return jsonError("select_balances", err);
    }
  }

  // PUT — 수동 조정. { memberUid, leaveTypeId, year, deltaDays?, totalDays?, reason? }
  //   deltaDays 우선 (잔여휴가 ±N일 조정). 없으면 totalDays 절대값.
  if (method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { memberUid, leaveTypeId, year, deltaDays, totalDays } = body;
    if (!memberUid || !leaveTypeId || !year) {
      return jsonError("validate", new Error("memberUid, leaveTypeId, year 필수"), 400);
    }
    if (deltaDays == null && totalDays == null) {
      return jsonError("validate", new Error("deltaDays 또는 totalDays 필수"), 400);
    }

    try {
      if (deltaDays != null) {
        // 기존 row 조회 (없으면 0 기준)
        const [existing] = await db
          .select()
          .from(attLeaveBalances)
          .where(and(
            eq(attLeaveBalances.memberUid, String(memberUid)),
            eq(attLeaveBalances.leaveTypeId, Number(leaveTypeId)),
            eq(attLeaveBalances.year, Number(year)),
          ))
          .limit(1);

          const base = existing ? Number(existing.totalDays) : 0;
        const next = base + Number(deltaDays);

        const [row] = await db
          .insert(attLeaveBalances)
          .values({
            memberUid: String(memberUid),
            leaveTypeId: Number(leaveTypeId),
            year: Number(year),
            totalDays: String(next),
            usedDays: existing ? String(existing.usedDays) : "0",
          } as any)
          .onConflictDoUpdate({
            target: [attLeaveBalances.memberUid, attLeaveBalances.leaveTypeId, attLeaveBalances.year],
            set: { totalDays: String(next) } as any,
          })
          .returning();
        return jsonOk(row);
      }

      // totalDays 절대값 경로 (기존 호환)
      const [row] = await db
        .insert(attLeaveBalances)
        .values({
          memberUid: String(memberUid),
          leaveTypeId: Number(leaveTypeId),
          year: Number(year),
          totalDays: String(totalDays),
          usedDays: "0",
        } as any)
        .onConflictDoUpdate({
          target: [attLeaveBalances.memberUid, attLeaveBalances.leaveTypeId, attLeaveBalances.year],
          set: { totalDays: String(totalDays) } as any,
        })
        .returning();
      return jsonOk(row);
    } catch (err) {
      return jsonError("upsert_balance", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
