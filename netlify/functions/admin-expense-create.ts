import { jsonKST } from "../../lib/kst";
import { db } from "../../db";
import { expenses, expenseCategories } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { eq } from "drizzle-orm";

export const config = { path: "/api/admin-expense-create" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(jsonKST({ ok: false, error: "요청 본문 파싱 실패", step: "parse" }), { status: 400 });
  }

  const { fiscalYear, occurredAt, categoryId, amount, payeeName, description, receiptUrl } = body;

  if (!fiscalYear || !occurredAt || !categoryId || amount === undefined) {
    return new Response(jsonKST({ ok: false, error: "필수 항목 누락 (fiscalYear, occurredAt, categoryId, amount)", step: "validate" }), { status: 400 });
  }
  if (Number(amount) <= 0) {
    return new Response(jsonKST({ ok: false, error: "금액은 0보다 커야 합니다", step: "validate_amount" }), { status: 400 });
  }

  // 카테고리 존재 확인 (§15.5)
  let catRows: typeof expenseCategories.$inferSelect[] = [];
  try {
    catRows = await db.select().from(expenseCategories).where(eq(expenseCategories.id, Number(categoryId))).limit(1);
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "카테고리 확인 실패", step: "select_category",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }
  if (!catRows.length) {
    return new Response(jsonKST({ ok: false, error: "존재하지 않는 카테고리", step: "validate_category" }), { status: 400 });
  }
  if (!catRows[0].isActive) {
    return new Response(jsonKST({ ok: false, error: "비활성화된 카테고리입니다", step: "validate_category_active" }), { status: 400 });
  }

  let inserted: typeof expenses.$inferSelect[] = [];
  try {
    inserted = await db.insert(expenses).values({
      fiscalYear: Number(fiscalYear),
      occurredAt: String(occurredAt),
      categoryId: Number(categoryId),
      amount: Number(amount),
      payeeName: payeeName ? String(payeeName) : null,
      description: description ? String(description) : null,
      receiptUrl: receiptUrl ? String(receiptUrl) : null,
      status: "draft",
      refundAmount: 0,
      recordedBy: auth.ctx.admin.uid ?? null,
      recordedAt: new Date(),
    } as any).returning();
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "지출 등록 실패", step: "insert",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }

  const r = inserted[0];
  return new Response(jsonKST({
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
        createdAt: r.createdAt,
      },
    },
  }), { headers: { "Content-Type": "application/json" } });
}
