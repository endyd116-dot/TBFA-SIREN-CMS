import { db } from "../../db";
import { otherRevenues } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { eq } from "drizzle-orm";

export const config = { path: "/api/admin-revenue-approve" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  // R45 CLUSTER-1: 재정 승인 권한 — DB 역할 기반(admin=super 기본·operator 차단·권한정책 UI 토글)
  if (!(await canAccess(auth.ctx.member.role ?? "", "finance_bookkeeping"))) {
    return new Response(JSON.stringify({ ok: false, error: "재정 승인 권한이 없습니다", step: "auth_role" }), { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "요청 본문 파싱 실패", step: "parse" }), { status: 400 });
  }

  // BUG-008 fix: 설계서(revenueId/reason)와 구현(id/rejectionReason) 키명 이중 지원
  const id              = body?.id              ?? body?.revenueId;
  const action          = body?.action;
  const rejectionReason = body?.rejectionReason ?? body?.reason;

  if (!id || !action) {
    return new Response(JSON.stringify({ ok: false, error: "id(또는 revenueId), action 필수", step: "validate" }), { status: 400 });
  }
  if (!["approve", "reject"].includes(action)) {
    return new Response(JSON.stringify({ ok: false, error: "action은 approve 또는 reject", step: "validate_action" }), { status: 400 });
  }
  if (action === "reject" && !rejectionReason) {
    return new Response(JSON.stringify({ ok: false, error: "반려 시 rejectionReason(또는 reason) 필수", step: "validate_reason" }), { status: 400 });
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

  if (existing[0].status !== "draft") {
    return new Response(JSON.stringify({ ok: false, error: "draft 상태만 승인·반려 가능합니다", step: "validate_status" }), { status: 400 });
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

  let updated: typeof otherRevenues.$inferSelect[] = [];
  try {
    updated = await db.update(otherRevenues).set(updateData as any).where(eq(otherRevenues.id, Number(id))).returning();
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "수입 승인/반려 처리 실패", step: "update",
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
        status: r.status,
        approvedBy: r.approvedBy,
        approvedAt: r.approvedAt,
        rejectionReason: r.rejectionReason,
        updatedAt: r.updatedAt,
      },
    },
  }), { headers: { "Content-Type": "application/json" } });
}
