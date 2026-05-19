/**
 * POST /api/att-amend-request
 * 본인의 출퇴근 수정 요청 등록.
 * body: { targetDate, amendType('CHECKIN'|'CHECKOUT'|'BOTH'), requestedCheckin, requestedCheckout, reason }
 * 응답: { ok:true, data: { id } }
 *
 * 등록 시 슈퍼어드민 전원에게 워크스페이스 알림 발송.
 */
import { db } from "../../db/index";
import { attCorrections, members } from "../../db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { broadcastNotification } from "../../lib/workspace-logger";

export const config = { path: "/api/att-amend-request" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "수정 요청 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

const AMEND_TO_CORRECTION: Record<string, "CHECK_IN" | "CHECK_OUT" | "BOTH"> = {
  CHECKIN:  "CHECK_IN",
  CHECKOUT: "CHECK_OUT",
  BOTH:     "BOTH",
  CHECK_IN: "CHECK_IN",   // 관용
  CHECK_OUT: "CHECK_OUT",
};

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { targetDate, amendType, requestedCheckin, requestedCheckout, reason } = body || {};

  if (!targetDate) return jsonError("validate", new Error("targetDate 필수"), 400);
  if (!reason || !String(reason).trim()) return jsonError("validate_reason", new Error("사유는 필수입니다"), 400);

  const correctionType = AMEND_TO_CORRECTION[String(amendType || "").toUpperCase()];
  if (!correctionType) {
    return jsonError("validate_type", new Error("amendType은 CHECKIN|CHECKOUT|BOTH 중 하나"), 400);
  }
  if (!requestedCheckin && !requestedCheckout) {
    return jsonError("validate_time", new Error("출근 또는 퇴근 시각 중 하나 이상 입력"), 400);
  }
  if (correctionType === "CHECK_IN"  && !requestedCheckin)  return jsonError("validate_time", new Error("출근 시각 필수"), 400);
  if (correctionType === "CHECK_OUT" && !requestedCheckout) return jsonError("validate_time", new Error("퇴근 시각 필수"), 400);
  if (correctionType === "BOTH"      && (!requestedCheckin || !requestedCheckout)) {
    return jsonError("validate_time", new Error("출퇴근 시각 모두 입력"), 400);
  }

  const memberUid = String(auth.ctx.member.id);
  const actorId   = auth.ctx.member.id;
  const actorName = auth.ctx.member.name ?? "직원";

  // 1. attCorrections INSERT
  let insertedId: number;
  try {
    const [row] = await db.insert(attCorrections).values({
      memberUid,
      targetDate,
      correctionType,
      requestedCheckIn:  requestedCheckin  ? new Date(requestedCheckin)  : null,
      requestedCheckOut: requestedCheckout ? new Date(requestedCheckout) : null,
      reason,
      status: "PENDING",
    }).returning({ id: attCorrections.id });
    insertedId = row.id;
  } catch (err) {
    return jsonError("insert_correction", err);
  }

  // 2. 슈퍼어드민 전원에게 알림 (fire-and-forget — 실패해도 메인 흐름 유지)
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
        sourceId: insertedId,
        notifType: "reminder_3d" as any,
        channel: "bell",
        title: `근태 수정 요청 — ${actorName}`,
        body: `${targetDate} 출퇴근 수정 요청이 접수되었습니다. 사유: ${String(reason).slice(0, 60)}`,
        actionUrl: "/admin-attendance-settings.html",
        category: "system",
      });
    }
  } catch (err) {
    console.warn("[att-amend-request] 슈퍼어드민 알림 실패:", err);
  }

  return jsonOk({ id: insertedId }, 201);
}
