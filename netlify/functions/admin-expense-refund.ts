import { db } from "../../db";
import { expenses } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { eq } from "drizzle-orm";

export const config = { path: "/api/admin-expense-refund" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  if (auth.ctx.admin.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민만 환불 처리할 수 있습니다", step: "auth_role" }), { status: 403 });
  }

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

  let existing: typeof expenses.$inferSelect[] = [];
  try {
    existing = await db.select().from(expenses).where(eq(expenses.id, Number(id))).limit(1);
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "지출 조회 실패", step: "select_expense",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }
  if (!existing.length) {
    return new Response(JSON.stringify({ ok: false, error: "존재하지 않는 지출 항목", step: "not_found" }), { status: 404 });
  }

  const exp = existing[0];

  if (exp.status !== "approved") {
    return new Response(JSON.stringify({ ok: false, error: "승인된 항목만 환불 처리 가능합니다", step: "validate_status" }), { status: 400 });
  }

  if (Number(refundAmount) > Number(exp.amount)) {
    return new Response(JSON.stringify({ ok: false, error: "환불금액이 원금을 초과할 수 없습니다", step: "validate_refund" }), { status: 400 });
  }

  let updated: typeof expenses.$inferSelect[] = [];
  try {
    updated = await db
      .update(expenses)
      .set({ refundAmount: Number(refundAmount), updatedAt: new Date() } as any)
      .where(eq(expenses.id, Number(id)))
      .returning();
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "지출 환불 처리 실패", step: "update",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }

  const r = updated[0];
  return new Response(JSON.stringify({
    ok: true,
    data: {
      expense: {
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
