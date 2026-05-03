/**
 * POST /api/billing-cancel
 *
 * 정기 후원 해지 (빌링키 비활성화)
 * - 회원 본인만 호출 가능
 * - billingKeys.isActive = false + deactivatedAt
 * - 토스 측 빌링키는 그대로 유지 (재활성화 가능)
 * - 다음 결제부터 자동 청구 중단
 *
 * Body: { billingKeyId, reason? }
 */
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, billingKeys, members } from "../../db";
import { authenticateUser } from "../../lib/auth";
import { safeValidate } from "../../lib/validation";
import {
  ok, badRequest, unauthorized, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

const cancelSchema = z.object({
  billingKeyId: z.number().int().positive(),
  reason: z.string().max(200).optional(),
});

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 로그인 검증 */
    const auth = authenticateUser(req);
    if (!auth) return unauthorized("로그인이 필요합니다");

    /* 2. 입력 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v: any = safeValidate(cancelSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);

    const { billingKeyId } = v.data;
    const reason: string | undefined = v.data.reason;

    /* 3. 회원 정보 */
    const [user] = await db
      .select({ id: members.id, name: members.name, status: members.status })
      .from(members)
      .where(eq(members.id, auth.uid))
      .limit(1);
    if (!user) return unauthorized("회원 정보를 찾을 수 없습니다");
    if (user.status === "withdrawn" || user.status === "suspended") {
      return unauthorized("이용할 수 없는 계정입니다");
    }

    /* 4. 빌링키 조회 */
    const [billing] = await db
      .select()
      .from(billingKeys)
      .where(eq(billingKeys.id, billingKeyId))
      .limit(1);

    if (!billing) return notFound("정기 후원 정보를 찾을 수 없습니다");

    /* 5. 본인 소유 검증 */
    if (billing.memberId !== user.id) {
      await logUserAction(req, user.id, user.name, "billing_cancel_denied", {
        target: `BK-${billingKeyId}`,
        detail: { reason: "not_owner" },
        success: false,
      });
      return forbidden("본인의 정기 후원만 해지할 수 있습니다");
    }

    /* 6. 이미 해지됨 차단 */
    if (!billing.isActive) {
      return badRequest("이미 해지된 정기 후원입니다");
    }

    /* 7. 해지 처리 */
    const now = new Date();
    const reasonText = reason
      ? `user_canceled: ${reason.slice(0, 180)}`
      : "user_canceled";

    const updatePayload: any = {
      isActive: false,
      deactivatedAt: now,
      deactivatedReason: reasonText.slice(0, 200),
      nextChargeAt: null,
      updatedAt: now,
    };

    const [updated] = await db
      .update(billingKeys)
      .set(updatePayload)
      .where(eq(billingKeys.id, billingKeyId))
      .returning({
        id: billingKeys.id,
        amount: billingKeys.amount,
      });

    /* 8. 감사 로그 */
    await logUserAction(req, user.id, user.name, "billing_cancel_success", {
      target: `BK-${billingKeyId}`,
      detail: {
        amount: updated.amount,
        reasonProvided: !!reason,
      },
    });

    return ok(
      { billingKeyId: updated.id },
      "정기 후원이 해지되었습니다. 그동안 함께해 주셔서 감사합니다.",
    );
  } catch (err) {
    console.error("[billing-cancel]", err);
    return serverError("정기 후원 해지 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/billing-cancel" };
