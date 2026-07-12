import { jsonKST } from "../../lib/kst";
import { db } from "../../db";
import { expenses } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { requireRole, roleForbidden } from "../../lib/admin-role";
import { eq } from "drizzle-orm";

export const config = { path: "/api/admin-expense-approve" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  if (!requireRole(auth.ctx.member, "super_admin")) return roleForbidden("super_admin");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(jsonKST({ ok: false, error: "요청 본문 파싱 실패", step: "parse" }), { status: 400 });
  }

  // BUG-008 fix (22-A 일관성): id/rejectionReason과 expenseId/reason 키명 이중 지원
  const id              = body?.id              ?? body?.expenseId;
  const action          = body?.action;
  const rejectionReason = body?.rejectionReason ?? body?.reason;

  if (!id || !action) {
    return new Response(jsonKST({ ok: false, error: "id(또는 expenseId), action 필수", step: "validate" }), { status: 400 });
  }
  if (!["approve", "reject"].includes(action)) {
    return new Response(jsonKST({ ok: false, error: "action은 approve 또는 reject", step: "validate_action" }), { status: 400 });
  }
  if (action === "reject" && !rejectionReason) {
    return new Response(jsonKST({ ok: false, error: "반려 시 rejectionReason(또는 reason) 필수", step: "validate_reason" }), { status: 400 });
  }

  let existing: typeof expenses.$inferSelect[] = [];
  try {
    existing = await db.select().from(expenses).where(eq(expenses.id, Number(id))).limit(1);
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "지출 조회 실패", step: "select_expense",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }
  if (!existing.length) {
    return new Response(jsonKST({ ok: false, error: "존재하지 않는 지출 항목", step: "not_found" }), { status: 404 });
  }

  if (existing[0].status !== "draft") {
    return new Response(jsonKST({ ok: false, error: "draft 상태만 승인·반려 가능합니다", step: "validate_status" }), { status: 400 });
  }

  const newStatus = action === "approve" ? "approved" : "rejected";
  const updateData: Record<string, any> = {
    status: newStatus,
    approvedBy: auth.ctx.admin.uid,
    approvedAt: new Date(),
    updatedAt: new Date(),
  };
  if (action === "reject") {
    updateData.rejectionReason = String(rejectionReason);
  }

  let updated: typeof expenses.$inferSelect[] = [];
  try {
    updated = await db.update(expenses).set(updateData as any).where(eq(expenses.id, Number(id))).returning();
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "지출 승인·반려 처리 실패", step: "update",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }

  const r = updated[0];
  return new Response(jsonKST({
    ok: true,
    data: {
      expense: {
        id: r.id,
        status: r.status,
        approvedBy: r.approvedBy,
        approvedAt: r.approvedAt,
        rejectionReason: r.rejectionReason,
        updatedAt: r.updatedAt,
      },
    },
  }), { headers: { "Content-Type": "application/json" } });
}
