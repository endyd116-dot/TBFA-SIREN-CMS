import { isoUTC, jsonKST } from "../../lib/kst";
import { db } from "../../db/index";
import { attLeaveRequests } from "../../db/schema";
import { eq, sql } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { createLeaveRequest, LeaveRequestError } from "../../lib/att-leave";

export const config = { path: "/api/att-leave-request" };

function jsonOk(data: unknown, status = 200) {
  return new Response(jsonKST({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(jsonKST({
    ok: false, error: "휴가 신청 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;

  const method = req.method;

  const memberUid: string = String(auth.ctx.member.id);

  // GET — 본인 신청 내역 (R34-P2 round3 P-G1: camelCase 정합)
  if (method === "GET") {
    try {
      const result: any = await db.execute(sql`
        SELECT
          r.id, r.member_uid, r.leave_type_id, r.start_date, r.end_date,
          r.days, r.reason, r.status, r.reviewed_by, r.review_note,
          r.created_at, r.updated_at,
          lt.name AS leave_type_name, lt.unit, lt.is_paid
        FROM att_leave_requests r
        JOIN att_leave_types lt ON lt.id = r.leave_type_id
        WHERE r.member_uid = ${memberUid}
        ORDER BY r.created_at DESC
        LIMIT 100
      `);
      /* drizzle 의 db.execute 는 (드라이버에 따라) 배열을 그대로 주기도 하고 { rows } 로 감싸기도 한다.
         .rows 만 믿으면 undefined 가 되어 .map 에서 터진다 — 실제로 휴가 신청 내역 조회가
         통째로 500 이었다(2026-07-12 전수 조사에서 발견). 코드베이스 표준 방어 패턴으로 통일. */
      const raw = ((result as any).rows ?? result ?? []) as any[];
      const rows = raw.map(r => ({
        id:           Number(r.id),
        memberUid:    r.member_uid,
        leaveTypeId:  Number(r.leave_type_id),
        leaveTypeName: r.leave_type_name,
        unit:         r.unit,
        isPaid:       r.is_paid,
        startDate:    r.start_date,
        endDate:      r.end_date,
        days:         r.days,
        reason:       r.reason,
        status:       r.status,
        reviewedBy:   r.reviewed_by,
        reviewNote:   r.review_note,
        createdAt:    isoUTC(r.created_at),
        updatedAt:    isoUTC(r.updated_at),
      }));
      return jsonOk(rows);
    } catch (err) {
      return jsonError("select_requests", err);
    }
  }

  // POST — 휴가 신청 (R29-ATT-GAP2: 서버 검증 강화)
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    /* 검사와 저장은 내부결재와 같은 공용 처리를 쓴다 (lib/att-leave.ts) */
    try {
      const created = await createLeaveRequest(memberUid, body);
      return jsonOk(created, 201);
    } catch (err: any) {
      if (err instanceof LeaveRequestError) {
        if (err.plain) {
          return new Response(jsonKST({
            ok: false, error: err.message, step: err.step, ...(err.conflict ? { conflict: err.conflict } : {}),
          }), { status: err.status, headers: { "Content-Type": "application/json" } });
        }
        return jsonError(err.step, err, err.status);
      }
      return jsonError("insert_request", err);
    }
  }

  // DELETE — 본인 PENDING 신청 셀프 철회 (Q3-009 잔여)
  //   PENDING은 아직 잔여 차감 전이라 복원 불필요 — 행 삭제만. 승인 후 취소는 관리자(admin-att-leave-review CANCELLED).
  if (method === "DELETE") {
    const url = new URL(req.url);
    const reqId = Number(url.searchParams.get("id"));
    if (!reqId) return jsonError("validate", new Error("id 필수"), 400);
    try {
      const [r] = await db.select().from(attLeaveRequests).where(eq(attLeaveRequests.id, reqId)).limit(1);
      if (!r) return jsonError("not_found", new Error("신청을 찾을 수 없습니다"), 404);
      if (String(r.memberUid) !== memberUid) return jsonError("forbidden", new Error("본인 신청만 철회할 수 있습니다"), 403);
      if (r.status !== "PENDING") return jsonError("invalid_status", new Error("승인 대기 중인 신청만 철회할 수 있습니다"), 409);
      await db.delete(attLeaveRequests).where(eq(attLeaveRequests.id, reqId));
      return jsonOk({ withdrawn: true, id: reqId });
    } catch (err) {
      return jsonError("withdraw", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
