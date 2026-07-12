import { yearKST, jsonKST } from "../../lib/kst";
import { db } from "../../db/index";
import { attLeaveBalances, attLeaveTypes, members } from "../../db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";

export const config = { path: "/api/admin-att-leave-balances" };

function jsonOk(data: unknown) {
  return new Response(jsonKST({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(jsonKST({
    ok: false, error: "잔여 휴가 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  // P2-39 fix: 조회(GET)는 근태 현황 권한(att_manage) 국장 허용, 변경은 이사장(super_admin) 전용
  const _role = (auth as any).ctx.member.role ?? "";
  if (req.method === "GET"
        ? !(_role === "super_admin" || await canAccess(_role, "att_manage"))
        : _role !== "super_admin") {
    return new Response(jsonKST({ ok: false, error: req.method === "GET" ? "근태 관리 권한이 없습니다" : "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const method = req.method;
  const url = new URL(req.url);

  // GET — 전체 직원 잔여 목록 (?year=). 잔여 기록이 없는 직원도 0으로 표시(직원 전체 노출).
  if (method === "GET") {
    const year = Number(url.searchParams.get("year") ?? yearKST());
    try {
      // 1) 활성 직원 목록 — admin-att-members 와 동일 기준(operatorActive=true OR 운영진 role)
      const memberRows = await db
        .select({
          id: members.id, name: members.name, email: members.email,
          role: members.role, operatorActive: members.operatorActive,
        })
        .from(members)
        .where(isNull(members.withdrawnAt));
      const staff = memberRows
        .filter(m => m.operatorActive === true ||
          (m.role != null && ["super_admin", "admin", "operator"].includes(m.role)))
        .map(m => ({ uid: String(m.id), name: m.name, email: m.email }));
      staff.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "ko"));

      // 2) 해당 연도 잔여 (단일 leftJoin — drizzle 다중 체인 금지 §6.3 준수)
      const balRows = await db
        .select({
          id:           attLeaveBalances.id,
          memberUid:    attLeaveBalances.memberUid,
          leaveTypeId:  attLeaveBalances.leaveTypeId,
          totalDays:    attLeaveBalances.totalDays,
          usedDays:     attLeaveBalances.usedDays,
          year:         attLeaveBalances.year,
          leaveTypeName: attLeaveTypes.name,
          unit:          attLeaveTypes.unit,
          displayOrder:  attLeaveTypes.displayOrder,
        })
        .from(attLeaveBalances)
        .leftJoin(attLeaveTypes, eq(attLeaveTypes.id, attLeaveBalances.leaveTypeId))
        .where(eq(attLeaveBalances.year, year));

      const balByMember = new Map<string, any[]>();
      for (const b of balRows) {
        const arr = balByMember.get(b.memberUid) || [];
        arr.push(b);
        balByMember.set(b.memberUid, arr);
      }
      for (const arr of balByMember.values()) {
        arr.sort((a, b) =>
          (Number(a.displayOrder ?? 0) - Number(b.displayOrder ?? 0)) ||
          (Number(a.leaveTypeId) - Number(b.leaveTypeId)));
      }

      // 3) flat 결과 — 직원 전체. 잔여 기록 없으면 빈 행 1개(hasBalance=false)
      const balances: any[] = [];
      for (const s of staff) {
        const bals = balByMember.get(s.uid) || [];
        if (bals.length === 0) {
          balances.push({
            id: null, memberUid: s.uid, memberName: s.name, memberEmail: s.email,
            leaveTypeId: null, leaveTypeName: null, unit: null,
            year, totalDays: 0, usedDays: 0, remainingDays: 0, hasBalance: false,
          });
        } else {
          for (const b of bals) {
            balances.push({
              id: Number(b.id), memberUid: s.uid, memberName: s.name, memberEmail: s.email,
              leaveTypeId: Number(b.leaveTypeId), leaveTypeName: b.leaveTypeName, unit: b.unit,
              year: Number(b.year), totalDays: Number(b.totalDays), usedDays: Number(b.usedDays),
              remainingDays: Number(b.totalDays) - Number(b.usedDays), hasBalance: true,
            });
          }
        }
      }
      return jsonOk(balances);
    } catch (err) {
      return jsonError("select_balances", err);
    }
  }

  // PUT — 수동 조정. { memberUid, leaveTypeId, year, deltaDays?, totalDays?, reason }
  //   deltaDays 우선 (잔여휴가 ±N일 조정). 없으면 totalDays 절대값.
  //   R39 Stage 7: reason 필수 + att_leave_balance_adjustments 이력 적재.
  if (method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { memberUid, leaveTypeId, year, deltaDays, totalDays, reason } = body;
    if (!memberUid || !leaveTypeId || !year) {
      return jsonError("validate", new Error("memberUid, leaveTypeId, year 필수"), 400);
    }
    if (deltaDays == null && totalDays == null) {
      return jsonError("validate", new Error("deltaDays 또는 totalDays 필수"), 400);
    }
    /* R39 Stage 7: 사유 필수 (감사 추적) */
    const reasonTrimmed = typeof reason === "string" ? reason.trim() : "";
    if (!reasonTrimmed) {
      return jsonError("validate", new Error("사유(reason) 필수 — 잔여 휴가 수동 조정 시 감사 추적용"), 400);
    }

    try {
      let resultRow: any;
      let appliedDelta: number; // 이력 기록용

      if (deltaDays != null) {
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
        appliedDelta = Number(deltaDays);

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
        resultRow = row;
      } else {
        // totalDays 절대값 경로
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
        appliedDelta = Number(totalDays) - base;

        const [row] = await db
          .insert(attLeaveBalances)
          .values({
            memberUid: String(memberUid),
            leaveTypeId: Number(leaveTypeId),
            year: Number(year),
            totalDays: String(totalDays),
            usedDays: existing ? String(existing.usedDays) : "0",
          } as any)
          .onConflictDoUpdate({
            target: [attLeaveBalances.memberUid, attLeaveBalances.leaveTypeId, attLeaveBalances.year],
            set: { totalDays: String(totalDays) } as any,
          })
          .returning();
        resultRow = row;
      }

      /* R39 Stage 7: 이력 적재 (실패해도 본 응답 영향 0) */
      try {
        const adminUid = String((auth as any).ctx.member.id);
        await db.execute(sql`
          INSERT INTO att_leave_balance_adjustments
            (member_uid, leave_type_id, year, delta_days, reason, adjusted_by)
          VALUES
            (${String(memberUid)}, ${Number(leaveTypeId)}, ${Number(year)},
             ${String(appliedDelta)}, ${reasonTrimmed}, ${adminUid})
        `);
      } catch (e) {
        console.warn("[admin-att-leave-balances] 이력 적재 실패:", e);
      }

      return jsonOk(resultRow);
    } catch (err) {
      return jsonError("upsert_balance", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
