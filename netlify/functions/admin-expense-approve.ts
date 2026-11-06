import { jsonKST } from "../../lib/kst";
import { db } from "../../db";
import { expenses } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { requireRole, roleForbidden } from "../../lib/admin-role";
import { eq } from "drizzle-orm";

import { syncLedger } from "../../lib/ledger-auto";
import { budgetPosition, recordBudgetLedger } from "../../lib/budget-ledger";

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

  /* 승인된 지출은 바로 장부에 옮긴다. 실패해도 야간 반영에서 처리된다 */
  if (action === "approve") {
    try {
      const budgetAccountId = (r as any).budgetAccountId == null ? null : Number((r as any).budgetAccountId);
      const year = Number(r.fiscalYear);
      const position = await budgetPosition(db, year, budgetAccountId);
      /* 승인이 이미 반영된 뒤라 집행 전 금액으로 되돌려 기록한다 */
      await recordBudgetLedger(db, {
        year, budgetAccountId, documentType: "expense", documentId: Number(r.id), type: "execute", amount: Number(r.amount),
        before: { ...position, executed: position.executed - Number(r.amount), reserved: position.reserved + Number(r.amount) },
        paidOn: String(r.occurredAt ?? "").slice(0, 10) || null,
        actor: { id: Number(auth.ctx.admin.uid), name: auth.ctx.member.name ?? "" },
        key: `execute:expense:${r.id}`, note: "직접 등록 지출",
      });
    } catch (err: any) {
      console.warn("[expense-approve] 예산 원장 기록 실패:", err?.message);
    }
    try { await syncLedger({ only: ["expense"] }); }
    catch (err: any) { console.warn("[expense-approve] 장부 반영 실패(야간 재시도):", err?.message); }
  }

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
