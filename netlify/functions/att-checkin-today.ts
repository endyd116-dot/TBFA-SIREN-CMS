/**
 * GET /api/att-checkin-today
 * 본인의 오늘(KST) 출퇴근 기록 단건 조회.
 * 응답: { ok:true, data: { checkinAt, checkoutAt, status, mode, workplaceId } | null }
 */
import { db } from "../../db/index";
import { attRecords } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/att-checkin-today" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "오늘 출퇴근 조회 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

function todayKST(): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const memberUid = String(auth.ctx.member.id);
  const today = todayKST();

  try {
    const rows = await db
      .select({
        checkinAt:   attRecords.checkInTime,
        checkoutAt:  attRecords.checkOutTime,
        status:      attRecords.status,
        mode:        attRecords.workMode,
        workplaceId: attRecords.workplaceId,
        date:        attRecords.date,
      })
      .from(attRecords)
      .where(and(eq(attRecords.memberUid, memberUid), eq(attRecords.date, today)))
      .limit(1);

    return jsonOk(rows[0] ?? null);
  } catch (err) {
    return jsonError("select_record", err);
  }
}
