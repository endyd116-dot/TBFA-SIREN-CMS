import { jsonKST } from "../../lib/kst";
import { db } from "../../db";
import { billingKeys, notifications } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { requireRole, roleForbidden } from "../../lib/admin-role";
import { logAdminAction } from "../../lib/audit";
import { eq } from "drizzle-orm";

export const config = { path: "/api/admin-billing-key-reactivate" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(
    jsonKST({
      ok: false,
      error: "빌링키 재활성화 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(
      jsonKST({ ok: false, error: "POST만 허용", step: "method" }),
      { status: 405, headers: { "Content-Type": "application/json" } },
    );
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if (!requireRole(auth.ctx.member, "admin")) return roleForbidden("admin");
  const { admin } = auth.ctx;

  let body: any;
  try {
    body = await req.json();
  } catch (err: any) {
    return jsonError("parse", err, 400);
  }

  const billingKeyId = Number(body?.billingKeyId);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (!Number.isFinite(billingKeyId) || billingKeyId <= 0) {
    return new Response(
      jsonKST({ ok: false, error: "billingKeyId가 유효하지 않습니다", step: "validate_id" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  if (reason.length < 5) {
    return new Response(
      jsonKST({ ok: false, error: "사유는 5자 이상 입력해야 합니다", step: "validate_reason" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  /* 빌링키 조회 */
  let existing: typeof billingKeys.$inferSelect[] = [];
  try {
    existing = await db
      .select()
      .from(billingKeys)
      .where(eq(billingKeys.id, billingKeyId))
      .limit(1);
  } catch (err: any) {
    return jsonError("select_billing_key", err);
  }

  if (!existing.length) {
    return new Response(
      jsonKST({ ok: false, error: "존재하지 않는 빌링키입니다", step: "not_found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const bk = existing[0];

  if (bk.isActive) {
    return new Response(
      jsonKST({ ok: false, error: "이미 활성 상태인 빌링키입니다", step: "already_active" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  /* 재활성화 UPDATE */
  let updated: typeof billingKeys.$inferSelect[] = [];
  try {
    updated = await db
      .update(billingKeys)
      .set({
        isActive: true,
        deactivatedAt: null,
        deactivatedReason: null,
        updatedAt: new Date(),
      } as any)
      .where(eq(billingKeys.id, billingKeyId))
      .returning();
  } catch (err: any) {
    return jsonError("update_billing_key", err);
  }

  const result = updated[0];

  /* 회원 알림 INSERT */
  if (result.memberId) {
    try {
      await db.insert(notifications).values({
        recipientId: result.memberId,
        recipientType: "user",
        category: "billing",
        severity: "info",
        title: "정기후원이 재활성화되었습니다",
        message: "관리자에 의해 정기후원 결제 수단이 재활성화되었습니다.",
        refTable: "billing_keys",
        refId: billingKeyId,
      } as any);
    } catch (err) {
      console.warn("[admin-billing-key-reactivate] 알림 INSERT 실패", err);
    }
  }

  /* 감사 로그 */
  try {
    await logAdminAction(req, admin.uid, admin.name, "billing_key_reactivate", {
      target: `BK-${billingKeyId}`,
      detail: {
        memberId: result.memberId,
        reason,
        cardNumberMasked: result.cardNumberMasked,
      },
    });
  } catch (err) {
    console.warn("[admin-billing-key-reactivate] 감사 로그 실패", err);
  }

  return new Response(
    jsonKST({
      ok: true,
      data: {
        billingKeyId: result.id,
        memberId: result.memberId,
        message: "정기후원이 재활성화되었습니다",
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
