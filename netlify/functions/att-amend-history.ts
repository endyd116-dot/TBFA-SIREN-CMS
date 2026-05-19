/**
 * GET /api/att-amend-history
 * 본인 출퇴근 수정 요청 이력 (최근 30건).
 * 응답: { ok:true, data: [{ id, targetDate, amendType, requestedCheckin, requestedCheckout, reason, status, reviewNote, createdAt }] }
 *
 * DB 컬럼명(CHECK_IN/CHECK_OUT)을 FE 명세(CHECKIN/CHECKOUT)에 맞춰 변환.
 *
 * [Deprecation Note 2026-05-19] att-amend-*는 워크스페이스 v1 호환 별칭.
 * 새 호출은 att-correction-* 사용 권장. 데이터·동작은 동일.
 * 통합 작업은 docs/REMAINING_WORK.md L 인벤토리 참조.
 */
import { db } from "../../db/index";
import { attCorrections } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/att-amend-history" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "수정요청 이력 조회 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

const CORRECTION_TO_AMEND: Record<string, "CHECKIN" | "CHECKOUT" | "BOTH"> = {
  CHECK_IN:  "CHECKIN",
  CHECK_OUT: "CHECKOUT",
  BOTH:      "BOTH",
};

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const memberUid = String(auth.ctx.member.id);

  try {
    const rows = await db
      .select()
      .from(attCorrections)
      .where(eq(attCorrections.memberUid, memberUid))
      .orderBy(desc(attCorrections.createdAt))
      .limit(30);

    const data = rows.map(r => ({
      id:                r.id,
      targetDate:        r.targetDate,
      amendType:         CORRECTION_TO_AMEND[r.correctionType] ?? r.correctionType,
      requestedCheckin:  r.requestedCheckIn,
      requestedCheckout: r.requestedCheckOut,
      reason:            r.reason,
      status:            r.status,
      reviewNote:        r.reviewNote,
      createdAt:         r.createdAt,
    }));

    return jsonOk(data);
  } catch (err) {
    return jsonError("select_history", err);
  }
}
