import { db } from "../../db/index";
import { attLeaveRequests, attLeaveBalances, attHolidays, attRecords, attLeaveTypes, members } from "../../db/schema";
import { eq, and, gte, lte, inArray, sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

export const config = { path: "/api/admin-att-leave-review" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "휴가 결재 실패", step,
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

  // GET — 결재 대기/처리 목록 (status=PENDING 기본)
  if (req.method === "GET") {
    try {
      const url = new URL(req.url);
      const status = url.searchParams.get("status") ?? "PENDING";

      const rows = await db
        .select()
        .from(attLeaveRequests)
        .where(eq(attLeaveRequests.status, status))
        .orderBy(attLeaveRequests.createdAt)
        .limit(100);

      // 신청자(members) + 휴가종류명 조인
      const memberIds = Array.from(
        new Set(rows.map(r => Number(r.memberUid)).filter(n => Number.isFinite(n) && n > 0))
      );
      const typeIds = Array.from(new Set(rows.map(r => r.leaveTypeId).filter(n => n != null)));

      let memberMap = new Map<number, { name: string; email: string }>();
      if (memberIds.length > 0) {
        try {
          const mRows = await db
            .select({ id: members.id, name: members.name, email: members.email })
            .from(members)
            .where(inArray(members.id, memberIds));
          for (const m of mRows) memberMap.set(m.id, { name: m.name, email: m.email });
        } catch (e) {
          console.warn("[admin-att-leave-review] member 조인 실패:", e);
        }
      }

      let typeMap = new Map<number, { name: string; unit: string }>();
      if (typeIds.length > 0) {
        try {
          const tRows = await db
            .select({ id: attLeaveTypes.id, name: attLeaveTypes.name, unit: attLeaveTypes.unit })
            .from(attLeaveTypes)
            .where(inArray(attLeaveTypes.id, typeIds));
          for (const t of tRows) typeMap.set(t.id, { name: t.name, unit: t.unit });
        } catch (e) {
          console.warn("[admin-att-leave-review] leave-type 조인 실패:", e);
        }
      }

      const leaves = rows.map(r => {
        const mInfo = memberMap.get(Number(r.memberUid));
        const tInfo = typeMap.get(r.leaveTypeId);
        return {
          id: r.id,
          memberUid: r.memberUid,
          memberName: mInfo?.name ?? "—",
          memberEmail: mInfo?.email ?? "",
          leaveTypeId: r.leaveTypeId,
          leaveTypeName: tInfo?.name ?? "—",
          startDate: r.startDate,
          endDate: r.endDate,
          days: r.days,
          isHalfDay: r.isHalfDay,
          halfDayPeriod: r.halfDayPeriod,
          reason: r.reason,
          status: r.status,
          submittedAt: r.createdAt,
        };
      });
      return jsonOk({ leaves });
    } catch (err) {
      return jsonError("select_leaves", err);
    }
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { requestId, action, note } = body;
  if (!requestId || !action) {
    return jsonError("validate", new Error("requestId, action 필수"), 400);
  }
  if (!["APPROVED", "REJECTED"].includes(action)) {
    return jsonError("validate_action", new Error("action은 APPROVED|REJECTED"), 400);
  }

  try {
    // 신청 건 조회
    const [request] = await db
      .select()
      .from(attLeaveRequests)
      .where(eq(attLeaveRequests.id, requestId))
      .limit(1);

    if (!request) return jsonError("not_found", new Error("휴가 신청 없음"), 404);
    if (request.status !== "PENDING") {
      return jsonError("already_reviewed", new Error("이미 처리된 신청"), 409);
    }

    // 결재 상태 업데이트
    const [updated] = await db
      .update(attLeaveRequests)
      .set({
        status: action,
        reviewedBy: String(auth.ctx.member.id),
        reviewNote: note ?? null,
        updatedAt: new Date(),
      } as any)
      .where(eq(attLeaveRequests.id, requestId))
      .returning();

    // APPROVED: 잔여 휴가 used_days 증가 + 기간 영업일에 attRecords LEAVE 반영
    if (action === "APPROVED") {
      const year = new Date(request.startDate).getFullYear();
      try {
        await db.execute(sql`
          UPDATE att_leave_balances
          SET used_days = used_days + ${request.days}
          WHERE member_uid = ${request.memberUid}
            AND leave_type_id = ${request.leaveTypeId}
            AND year = ${year}
        `);
      } catch (err) {
        console.warn("[admin-att-leave-review] 잔여 휴가 차감 실패:", err);
      }

      // 휴가 기간 영업일(주말·공휴일 제외)에 attRecords UPSERT(status=LEAVE)
      try {
        const startStr = String(request.startDate);
        const endStr = String(request.endDate);

        // 공휴일 목록
        const hRows = await db
          .select({ date: attHolidays.date })
          .from(attHolidays)
          .where(and(gte(attHolidays.date, startStr), lte(attHolidays.date, endStr)));
        const holidaySet = new Set(hRows.map(h => String(h.date)));

        // 날짜 enumerate
        const dates: string[] = [];
        let cur = new Date(`${startStr}T00:00:00Z`);
        const end = new Date(`${endStr}T00:00:00Z`);
        while (cur.getTime() <= end.getTime()) {
          const dow = cur.getUTCDay(); // 0=일, 6=토
          const ds = cur.toISOString().slice(0, 10);
          if (dow !== 0 && dow !== 6 && !holidaySet.has(ds)) {
            dates.push(ds);
          }
          cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
        }

        // UPSERT per date — 충돌(memberUid, date) 시 status='LEAVE', 출퇴근 비움
        for (const d of dates) {
          try {
            await db.execute(sql`
              INSERT INTO att_records (member_uid, date, status, work_mode)
              VALUES (${request.memberUid}, ${d}::date, 'LEAVE', NULL)
              ON CONFLICT (member_uid, date)
              DO UPDATE SET
                status = 'LEAVE',
                check_in_time = NULL,
                check_out_time = NULL,
                working_mins = NULL,
                overtime_mins = 0,
                updated_at = NOW()
            `);
          } catch (innerErr) {
            console.warn(`[admin-att-leave-review] LEAVE 반영 실패 ${d}:`, innerErr);
          }
        }
      } catch (err) {
        console.warn("[admin-att-leave-review] 휴가 기간 LEAVE 반영 실패:", err);
      }
    }

    // REJECTED: 기존에 LEAVE 로 박혀있던 attRecords 제거 (있다면)
    if (action === "REJECTED") {
      try {
        await db.execute(sql`
          DELETE FROM att_records
          WHERE member_uid = ${request.memberUid}
            AND date >= ${String(request.startDate)}::date
            AND date <= ${String(request.endDate)}::date
            AND status = 'LEAVE'
            AND check_in_time IS NULL
            AND check_out_time IS NULL
        `);
      } catch (err) {
        console.warn("[admin-att-leave-review] LEAVE 복원 실패:", err);
      }
    }

    // 결과 알림 → 신청자
    try {
      const recipientId = Number(request.memberUid);
      if (Number.isFinite(recipientId) && recipientId > 0) {
        await sendWorkspaceNotification({
          memberId: recipientId,
          sourceType: "event" as any,
          sourceId: request.id,
          notifType: action === "APPROVED" ? "approved" : "rejected",
          channel: "bell",
          title: action === "APPROVED" ? "휴가 신청 승인" : "휴가 신청 반려",
          body: `${request.startDate} ~ ${request.endDate} (${request.days}일) — ${action === "APPROVED" ? "승인" : "반려"}${note ? ` · ${String(note).slice(0, 100)}` : ""}`,
          actionUrl: "/workspace-attendance.html",
          category: "system",
        });
      }
    } catch (err) {
      console.warn("[admin-att-leave-review] 결과 알림 실패:", err);
    }

    return jsonOk(updated);
  } catch (err) {
    return jsonError("review_leave", err);
  }
}
