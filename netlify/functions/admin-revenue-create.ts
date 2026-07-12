import { jsonKST } from "../../lib/kst";
import { db } from "../../db";
import { otherRevenues, revenueCategories } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { eq } from "drizzle-orm";

export const config = { path: "/api/admin-revenue-create" };

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

  const { recognizedAt, categoryId, amount, payerName, description, receiptUrl } = body;

  if (!recognizedAt || !categoryId || !amount) {
    return new Response(jsonKST({ ok: false, error: "필수 항목 누락 (recognizedAt, categoryId, amount)", step: "validate" }), { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(recognizedAt))) {
    return new Response(jsonKST({ ok: false, error: "recognizedAt 형식 오류 (YYYY-MM-DD 필요)", step: "validate_date" }), { status: 400 });
  }
  if (Number(amount) <= 0) {
    return new Response(jsonKST({ ok: false, error: "금액은 0보다 커야 합니다", step: "validate" }), { status: 400 });
  }

  // BUG-004 fix: fiscalYear는 recognizedAt 연도로 서버 자동 계산 — 클라이언트 입력값 무시
  const fiscalYear = Number(String(recognizedAt).slice(0, 4));

  // 카테고리 존재 확인
  let catRows: typeof revenueCategories.$inferSelect[] = [];
  try {
    catRows = await db.select().from(revenueCategories).where(eq(revenueCategories.id, Number(categoryId))).limit(1);
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

  let inserted: typeof otherRevenues.$inferSelect[] = [];
  try {
    inserted = await db.insert(otherRevenues).values({
      fiscalYear: Number(fiscalYear),
      recognizedAt: String(recognizedAt),
      categoryId: Number(categoryId),
      amount: Number(amount),
      payerName: payerName ? String(payerName) : null,
      description: description ? String(description) : null,
      receiptUrl: receiptUrl ? String(receiptUrl) : null,
      status: "draft",
      refundAmount: 0,
      recordedBy: auth.ctx.admin.uid ?? null,
      recordedAt: new Date(),
    } as any).returning();
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "수입 등록 실패", step: "insert",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }

  const r = inserted[0];
  return new Response(jsonKST({
    ok: true,
    data: {
      revenue: {
        id: r.id,
        fiscalYear: r.fiscalYear,
        recognizedAt: r.recognizedAt,
        categoryId: r.categoryId,
        amount: Number(r.amount),
        payerName: r.payerName,
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
