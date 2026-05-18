import { db } from "../../db/index";
import { attCorrections, attRecords } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-att-correction-review" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "수정 요청 결재 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  if (auth.member.role !== "super_admin") {
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
    const [correction] = await db
      .select()
      .from(attCorrections)
      .where(eq(attCorrections.id, requestId))
      .limit(1);

    if (!correction) return jsonError("not_found", new Error("수정 요청 없음"), 404);
    if (correction.status !== "PENDING") {
      return jsonError("already_reviewed", new Error("이미 처리된 요청"), 409);
    }

    // 결재 상태 업데이트
    const [updated] = await db
      .update(attCorrections)
      .set({
        status: action,
        reviewedBy: auth.member.uid,
        reviewNote: note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(attCorrections.id, requestId))
      .returning();

    // APPROVED: att_records 해당 날짜 기록 업데이트
    if (action === "APPROVED") {
      try {
        const updateFields: Record<string, any> = {
          isManuallyAdjusted: true,
          updatedAt: new Date(),
        };
        if (
          correction.correctionType === "CHECK_IN" ||
          correction.correctionType === "BOTH"
        ) {
          updateFields.checkInTime = correction.requestedCheckIn;
        }
        if (
          correction.correctionType === "CHECK_OUT" ||
          correction.correctionType === "BOTH"
        ) {
          updateFields.checkOutTime = correction.requestedCheckOut;
        }

        await db
          .update(attRecords)
          .set(updateFields)
          .where(
            and(
              eq(attRecords.memberUid, correction.memberUid),
              eq(attRecords.date, correction.targetDate)
            )
          );
      } catch (err) {
        console.warn("[admin-att-correction-review] 출퇴근 기록 반영 실패:", err);
      }
    }

    return jsonOk(updated);
  } catch (err) {
    return jsonError("review_correction", err);
  }
}
