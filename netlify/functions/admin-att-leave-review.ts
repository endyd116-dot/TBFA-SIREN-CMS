import { jsonKST } from "../../lib/kst";
import { db } from "../../db/index";
import { attLeaveRequests, attLeaveTypes, members } from "../../db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { applyLeaveDecision } from "../../lib/att-leave";

export const config = { path: "/api/admin-att-leave-review" };

function jsonOk(data: unknown) {
  return new Response(jsonKST({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(jsonKST({
    ok: false, error: "휴가 결재 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

/* 내부결재 문서와 연결된 휴가 신청. 연결 칸이 없는 동안에는 빈 목록으로 계속한다 */
async function docLinkedLeaves(): Promise<Set<number>> {
  try {
    const res: any = await db.execute(sql`SELECT att_leave_request_id FROM approval_requests WHERE att_leave_request_id IS NOT NULL`);
    return new Set(((res?.rows ?? res ?? []) as any[]).map((r) => Number(r.att_leave_request_id)));
  } catch (err) {
    console.warn("[admin-att-leave-review] 문서 연결 조회 실패:", err);
    return new Set();
  }
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  // R45 §4-1: 근태 일상 결재는 운영자 허용(att_manage)·정책/마스터/기록수정은 super 유지
  if (!(await canAccess((auth as any).ctx.member.role ?? "", "att_manage"))) {
    return new Response(jsonKST({ ok: false, error: "근태 관리 권한이 없습니다" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  // GET — 결재 대기/처리 목록 (status=PENDING 기본)
  if (req.method === "GET") {
    try {
      const url = new URL(req.url);
      const status = url.searchParams.get("status") ?? "PENDING";

      const linked = await docLinkedLeaves();
      const rows = (await db
        .select()
        .from(attLeaveRequests)
        .where(eq(attLeaveRequests.status, status))
        .orderBy(attLeaveRequests.createdAt)
        .limit(100)).filter((r) => status !== "PENDING" || !linked.has(Number(r.id)));

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
  if (!["APPROVED", "REJECTED", "CANCELLED"].includes(action)) {
    return jsonError("validate_action", new Error("action은 APPROVED|REJECTED|CANCELLED"), 400);
  }

  try {
    // 신청 건 조회
    const [request] = await db
      .select()
      .from(attLeaveRequests)
      .where(eq(attLeaveRequests.id, requestId))
      .limit(1);

    if (!request) return jsonError("not_found", new Error("휴가 신청 없음"), 404);
    if ((await docLinkedLeaves()).has(Number(request.id))) {
      return jsonError("doc_linked", new Error("내부결재 문서로 올린 휴가입니다. 문서에서 처리해 주세요"), 409);
    }
    /* Q3-009 fix: 승인취소(CANCELLED)는 APPROVED 건에만, 승인/반려는 PENDING 건에만 허용 */
    if (action === "CANCELLED") {
      if (request.status !== "APPROVED") {
        return jsonError("invalid_transition", new Error("승인된 휴가만 취소할 수 있습니다"), 409);
      }
    } else if (request.status !== "PENDING") {
      return jsonError("already_reviewed", new Error("이미 처리된 신청"), 409);
    }

    // P2-56 fix: 셀프 결재 차단 — 본인이 신청한 휴가는 본인이 승인할 수 없음 (이사장 예외). 매출 성과검증 4-eye 원칙과 동일.
    if (action === "APPROVED"
        && String(request.memberUid) === String(auth.ctx.member.id)
        && auth.ctx.member.role !== "super_admin") {
      return jsonError("self_review", new Error("본인이 신청한 건은 본인이 승인할 수 없습니다 (다른 결재자에게 요청하세요)"), 403);
    }

    /* 차감·근태 기록·알림은 내부결재와 같은 공용 처리를 쓴다 (lib/att-leave.ts) */
    const updated = await applyLeaveDecision(request, action, String(auth.ctx.member.id), note);

    return jsonOk(updated);
  } catch (err) {
    return jsonError("review_leave", err);
  }
}
