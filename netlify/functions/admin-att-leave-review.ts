import { db } from "../../db/index";
import { attLeaveRequests, attLeaveBalances } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

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
  if (!auth.ok) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
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
        reviewedBy: (auth as any).ctx.member.uid,
        reviewNote: note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(attLeaveRequests.id, requestId))
      .returning();

    // APPROVED: 잔여 휴가 used_days 증가
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
    }

    return jsonOk(updated);
  } catch (err) {
    return jsonError("review_leave", err);
  }
}
