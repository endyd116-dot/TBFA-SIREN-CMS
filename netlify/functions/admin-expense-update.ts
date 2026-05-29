import { db } from "../../db";
import { expenses, expenseCategories } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { eq } from "drizzle-orm";

export const config = { path: "/api/admin-expense-update" };

export default async function handler(req: Request): Promise<Response> {
  // BUG-007 fix: PUT·PATCH 둘 다 허용 (전체 교체·부분 수정 양쪽 지원)
  if (req.method !== "PUT" && req.method !== "PATCH") {
    return new Response(JSON.stringify({ ok: false, error: "PUT 또는 PATCH만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "요청 본문 파싱 실패", step: "parse" }), { status: 400 });
  }

  const { id, fiscalYear, occurredAt, categoryId, amount, payeeName, description, receiptUrl } = body;

  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: "id 필수", step: "validate" }), { status: 400 });
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

  // approved 상태는 수정 불가
  if (exp.status === "approved") {
    return new Response(JSON.stringify({ ok: false, error: "승인된 항목은 수정할 수 없습니다", step: "validate_status" }), { status: 400 });
  }
  if (exp.status === "rejected") {
    return new Response(JSON.stringify({ ok: false, error: "반려된 항목은 수정할 수 없습니다", step: "validate_status" }), { status: 400 });
  }

  // 권한: admin+ 또는 등록자 본인 (R45 CLUSTER-1: DB 역할·JWT 신뢰 금지·admin=super)
  const adminRole = auth.ctx.member.role;
  const adminUid = auth.ctx.member.id;
  if (adminRole !== "super_admin" && adminRole !== "admin" && exp.recordedBy !== adminUid) {
    return new Response(JSON.stringify({ ok: false, error: "수정 권한이 없습니다 (등록자 또는 슈퍼어드민만 가능)", step: "auth_check" }), { status: 403 });
  }

  // 카테고리 확인 (변경 시)
  if (categoryId !== undefined && Number(categoryId) !== exp.categoryId) {
    let catRows: typeof expenseCategories.$inferSelect[] = [];
    try {
      catRows = await db.select().from(expenseCategories).where(eq(expenseCategories.id, Number(categoryId))).limit(1);
    } catch (err: any) {
      return new Response(JSON.stringify({
        ok: false, error: "카테고리 확인 실패", step: "select_category",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }), { status: 500 });
    }
    if (!catRows.length) {
      return new Response(JSON.stringify({ ok: false, error: "존재하지 않는 카테고리", step: "validate_category" }), { status: 400 });
    }
    if (!catRows[0].isActive) {
      return new Response(JSON.stringify({ ok: false, error: "비활성화된 카테고리입니다", step: "validate_category_active" }), { status: 400 });
    }
  }

  if (amount !== undefined && Number(amount) <= 0) {
    return new Response(JSON.stringify({ ok: false, error: "금액은 0보다 커야 합니다", step: "validate_amount" }), { status: 400 });
  }

  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (fiscalYear !== undefined) updateData.fiscalYear = Number(fiscalYear);
  if (occurredAt !== undefined) updateData.occurredAt = String(occurredAt);
  if (categoryId !== undefined) updateData.categoryId = Number(categoryId);
  if (amount !== undefined) updateData.amount = Number(amount);
  if (payeeName !== undefined) updateData.payeeName = payeeName ? String(payeeName) : null;
  if (description !== undefined) updateData.description = description ? String(description) : null;
  if (receiptUrl !== undefined) updateData.receiptUrl = receiptUrl ? String(receiptUrl) : null;

  let updated: typeof expenses.$inferSelect[] = [];
  try {
    updated = await db.update(expenses).set(updateData as any).where(eq(expenses.id, Number(id))).returning();
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "지출 수정 실패", step: "update",
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
        fiscalYear: r.fiscalYear,
        occurredAt: r.occurredAt,
        categoryId: r.categoryId,
        amount: Number(r.amount),
        payeeName: r.payeeName,
        description: r.description,
        receiptUrl: r.receiptUrl,
        status: r.status,
        refundAmount: Number(r.refundAmount),
        recordedBy: r.recordedBy,
        recordedAt: r.recordedAt,
        updatedAt: r.updatedAt,
      },
    },
  }), { headers: { "Content-Type": "application/json" } });
}
