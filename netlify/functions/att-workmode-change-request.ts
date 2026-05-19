/**
 * R36-Att-Optional A-1: 직원 역방향 근무형태 변경 신청
 *
 * GET  /api/att-workmode-change-request — 본인 신청 이력
 * POST /api/att-workmode-change-request — 신청 등록
 *   body: { targetMode, targetDate, reason }
 */
import { db } from "../../db/index";
import { attWorkmodeChangeRequests, members } from "../../db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { broadcastNotification } from "../../lib/workspace-logger";

export const config = { path: "/api/att-workmode-change-request" };

const VALID_MODES = ["OFFICE", "REMOTE", "FIELD", "BUSINESS_TRIP", "HYBRID"];

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "근무형태 변경 신청 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;

  const memberUid: string = String(auth.ctx.member.id);

  if (req.method === "GET") {
    try {
      const rows = await db
        .select()
        .from(attWorkmodeChangeRequests)
        .where(eq(attWorkmodeChangeRequests.memberUid, memberUid))
        .orderBy(sql`created_at DESC`)
        .limit(100);
      return jsonOk(rows);
    } catch (err) {
      return jsonError("select_requests", err);
    }
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { targetMode, targetDate, reason } = body;
  if (!targetMode || !targetDate) {
    return jsonError("validate", new Error("targetMode, targetDate 필수"), 400);
  }
  if (!VALID_MODES.includes(String(targetMode))) {
    return jsonError("validate_mode", new Error(`targetMode는 ${VALID_MODES.join("|")}`), 400);
  }
  if (!reason || !String(reason).trim()) {
    return jsonError("validate_reason", new Error("사유는 필수입니다"), 400);
  }

  let insertedRow: any;
  try {
    const [row] = await db.insert(attWorkmodeChangeRequests).values({
      memberUid,
      targetMode: String(targetMode),
      targetDate: String(targetDate),
      reason: String(reason),
      status: "PENDING",
    } as any).returning();
    insertedRow = row;
  } catch (err) {
    return jsonError("insert_request", err);
  }

  // 슈퍼어드민 전원에게 결재 요청 알림 (fire-and-forget)
  const actorId = auth.ctx.member.id;
  const actorName = auth.ctx.member.name ?? "직원";
  try {
    const sup = await db
      .select({ id: members.id })
      .from(members)
      .where(and(
        eq(members.role, "super_admin"),
        eq(members.operatorActive as any, true),
        isNull(members.withdrawnAt),
      ));
    const recipientIds = sup.map(s => s.id).filter(id => id !== actorId);
    if (recipientIds.length > 0) {
      await broadcastNotification(recipientIds, {
        sourceType: "event" as any,
        sourceId: insertedRow.id,
        notifType: "reminder_3d" as any,
        channel: "bell",
        title: `근무형태 변경 신청 — ${actorName}`,
        body: `${targetDate} ${targetMode} 변경 신청. 사유: ${String(reason).slice(0, 60)}`,
        actionUrl: "/admin-workspace-management.html",
        category: "system",
      });
    }
  } catch (err) {
    console.warn("[att-workmode-change-request] 슈퍼어드민 알림 실패:", err);
  }

  return jsonOk(insertedRow, 201);
}
