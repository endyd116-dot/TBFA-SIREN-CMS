import { db } from "../../db";
import { otherRevenues, revenueCategories } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { eq } from "drizzle-orm";

export const config = { path: "/api/admin-revenue-update" };

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

  const { id, fiscalYear, recognizedAt, categoryId, amount, payerName, description, receiptUrl } = body;

  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: "id 필수", step: "validate" }), { status: 400 });
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

  // draft 상태만 수정 가능
  if (rev.status !== "draft") {
    return new Response(JSON.stringify({ ok: false, error: "draft 상태만 수정 가능합니다", step: "validate_status" }), { status: 400 });
  }

  // 권한: admin+ 또는 등록자 본인 (R45 CLUSTER-1: DB 역할·JWT 신뢰 금지·admin=super)
  const adminRole = auth.ctx.member.role;
  const adminUid = auth.ctx.member.id;
  if (adminRole !== "super_admin" && adminRole !== "admin" && rev.recordedBy !== adminUid) {
    return new Response(JSON.stringify({ ok: false, error: "수정 권한이 없습니다 (등록자 또는 슈퍼어드민만 가능)", step: "auth_check" }), { status: 403 });
  }

  // 카테고리 확인 (변경 시)
  if (categoryId && Number(categoryId) !== rev.categoryId) {
    let catRows: typeof revenueCategories.$inferSelect[] = [];
    try {
      catRows = await db.select().from(revenueCategories).where(eq(revenueCategories.id, Number(categoryId))).limit(1);
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
  }

  if (amount !== undefined && Number(amount) <= 0) {
    return new Response(JSON.stringify({ ok: false, error: "금액은 0보다 커야 합니다", step: "validate_amount" }), { status: 400 });
  }

  const updateData: Record<string, any> = {
    updatedAt: new Date(),
  };
  if (fiscalYear !== undefined) updateData.fiscalYear = Number(fiscalYear);
  if (recognizedAt !== undefined) updateData.recognizedAt = String(recognizedAt);
  if (categoryId !== undefined) updateData.categoryId = Number(categoryId);
  if (amount !== undefined) updateData.amount = Number(amount);
  if (payerName !== undefined) updateData.payerName = payerName ? String(payerName) : null;
  if (description !== undefined) updateData.description = description ? String(description) : null;
  if (receiptUrl !== undefined) updateData.receiptUrl = receiptUrl ? String(receiptUrl) : null;

  let updated: typeof otherRevenues.$inferSelect[] = [];
  try {
    updated = await db.update(otherRevenues).set(updateData as any).where(eq(otherRevenues.id, Number(id))).returning();
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "수입 수정 실패", step: "update",
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
        updatedAt: r.updatedAt,
      },
    },
  }), { headers: { "Content-Type": "application/json" } });
}
