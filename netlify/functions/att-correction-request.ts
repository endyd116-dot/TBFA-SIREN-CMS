import { db } from "../../db/index";
import { attCorrections, members } from "../../db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { broadcastNotification } from "../../lib/workspace-logger";

export const config = { path: "/api/att-correction-request" };

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

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;

  const method = req.method;

  const memberUid: string = String(auth.ctx.member.id);

  // GET — 본인 수정 요청 내역
  if (method === "GET") {
    try {
      const rows = await db
        .select()
        .from(attCorrections)
        .where(eq(attCorrections.memberUid, memberUid))
        .orderBy(sql`created_at DESC`)
        .limit(100);
      return jsonOk(rows);
    } catch (err) {
      return jsonError("select_corrections", err);
    }
  }

  // POST — 수정 요청 등록
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { targetDate, correctionType, requestedCheckIn, requestedCheckOut, reason, evidenceUrl } = body;
    if (!targetDate || !correctionType) {
      return jsonError("validate", new Error("targetDate, correctionType 필수"), 400);
    }
    if (!["CHECK_IN", "CHECK_OUT", "BOTH"].includes(correctionType)) {
      return jsonError("validate_type", new Error("correctionType은 CHECK_IN|CHECK_OUT|BOTH"), 400);
    }
    if (!reason || !String(reason).trim()) {
      return jsonError("validate_reason", new Error("사유는 필수입니다"), 400);
    }

    let insertedRow: any;
    try {
      const [row] = await db.insert(attCorrections).values({
        memberUid,
        targetDate,
        correctionType,
        requestedCheckIn:  requestedCheckIn  ? new Date(requestedCheckIn)  : null,
        requestedCheckOut: requestedCheckOut ? new Date(requestedCheckOut) : null,
        reason:       reason,
        evidenceUrl:  evidenceUrl  ?? null,
        status: "PENDING",
      } as any).returning();
      insertedRow = row;
    } catch (err) {
      return jsonError("insert_correction", err);
    }

    // R34-P2 (round2 P4 해소): 슈퍼어드민 전원에게 알림 (fire-and-forget)
    const actorId   = auth.ctx.member.id;
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
          title: `근태 수정 요청 — ${actorName}`,
          body: `${targetDate} 출퇴근 수정 요청이 접수되었습니다. 사유: ${String(reason).slice(0, 60)}`,
          actionUrl: "/admin-workspace-management.html",
          category: "system",
        });
      }
    } catch (err) {
      console.warn("[att-correction-request] 슈퍼어드민 알림 실패:", err);
    }

    return jsonOk(insertedRow, 201);
  }

  return new Response("Method Not Allowed", { status: 405 });
}
