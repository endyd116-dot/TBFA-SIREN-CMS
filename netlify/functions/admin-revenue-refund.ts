import { db } from "../../db";
import { otherRevenues } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { eq } from "drizzle-orm";

export const config = { path: "/api/admin-revenue-refund" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "요청 본문 파싱 실패", step: "parse" }), { status: 400 });
  }

  const { id, refundAmount } = body;

  if (!id || refundAmount === undefined) {
    return new Response(JSON.stringify({ ok: false, error: "id, refundAmount 필수", step: "validate" }), { status: 400 });
  }
  if (Number(refundAmount) < 0) {
    return new Response(JSON.stringify({ ok: false, error: "환불금액은 0 이상이어야 합니다", step: "validate_amount" }), { status: 400 });
  }

  // 기존 레코드 조회
  let existing: typeof otherRevenues.$inferSelect[] = [];
  try {
    existing = await db.select().from(otherRevenues).where(eq(otherRevenues.id, Number(id))).limit(1);
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "수입 조회 실패", step: "select_revenue",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }

  if (!existing.length) {
    return new Response(JSON.stringify({ ok: false, error: "존재하지 않는 수입 항목", step: "not_found" }), { status: 404 });
  }

  const rev = existing[0];

  // approved 상태만 환불 가능
  if (rev.status !== "approved") {
    return new Response(JSON.stringify({ ok: false, error: "승인된 항목만 환불 처리 가능합니다", step: "validate_status" }), { status: 400 });
  }

  // 누적 환불 계산 — BUG-001 fix: 기존 환불액에 신규 환불액을 더함
  const currentRefund = Number(rev.refundAmount) || 0;
  const incremental   = Number(refundAmount);
  const newTotalRefund = currentRefund + incremental;

  if (newTotalRefund > Number(rev.amount)) {
    return new Response(JSON.stringify({
      ok: false,
      error: `누적 환불액이 원금을 초과합니다. 기존 환불 ${currentRefund.toLocaleString("ko-KR")}원 + 신규 ${incremental.toLocaleString("ko-KR")}원 = ${newTotalRefund.toLocaleString("ko-KR")}원 > 원금 ${Number(rev.amount).toLocaleString("ko-KR")}원`,
      step: "validate_refund_total",
      currentRefund,
      incremental,
      amount: Number(rev.amount),
    }), { status: 400 });
  }

  let updated: typeof otherRevenues.$inferSelect[] = [];
  try {
    updated = await db
      .update(otherRevenues)
      .set({ refundAmount: newTotalRefund, updatedAt: new Date() } as any)
      .where(eq(otherRevenues.id, Number(id)))
      .returning();
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "환불 처리 실패", step: "update",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }

  const r = updated[0];
  return new Response(JSON.stringify({
    ok: true,
    data: {
      revenue: {
        id: r.id,
        amount: Number(r.amount),
        refundAmount: Number(r.refundAmount),
        netAmount: Number(r.amount) - Number(r.refundAmount),
        status: r.status,
        updatedAt: r.updatedAt,
      },
    },
  }), { headers: { "Content-Type": "application/json" } });
}
