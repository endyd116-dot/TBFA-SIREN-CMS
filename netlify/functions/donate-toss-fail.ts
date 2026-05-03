/**
 * POST /api/donate-toss-fail
 *
 * 토스 결제 실패 기록
 * - payment-fail.html이 호출 (선택적)
 * - donations 행을 failed로 업데이트 + 사유 기록
 * - 이미 completed면 무시 (멱등성)
 *
 * Body: { donationId, code?, message?, orderId? }
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, donations } from "../../db";
import { safeValidate } from "../../lib/validation";
import {
  ok, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

const failSchema = z.object({
  donationId: z.number().int().positive(),
  code: z.string().max(100).optional(),
  message: z.string().max(500).optional(),
  orderId: z.string().max(64).optional(),
});

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v: any = safeValidate(failSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);

    const { donationId, code, message, orderId } = v.data;

    /* 1. donations 조회 */
    const [donation] = await db
      .select()
      .from(donations)
      .where(eq(donations.id, donationId))
      .limit(1);

    if (!donation) {
      return notFound("주문 정보를 찾을 수 없습니다");
    }

    /* 2. 이미 처리된 건은 무시 (멱등성) */
    if (donation.status === "completed") {
      return ok({}, "이미 완료된 결제입니다 (변경 없음)");
    }
    if (donation.status === "failed") {
      return ok({}, "이미 실패 처리된 결제입니다");
    }

    /* 3. failed로 업데이트 */
    const reason = [
      code ? `[${code}]` : "",
      message || "사용자 취소 또는 결제창 종료",
    ].filter(Boolean).join(" ");

    const updatePayload: any = {
      status: "failed",
      failureReason: reason.slice(0, 500),
      updatedAt: new Date(),
    };

    await db
      .update(donations)
      .set(updatePayload)
      .where(eq(donations.id, donationId));

    /* 4. 감사 로그 */
    await logUserAction(req, donation.memberId, donation.donorName, "donate_toss_user_fail", {
      target: orderId || donation.tossOrderId || `D-${donationId}`,
      detail: {
        donationId,
        code,
        message: message?.slice(0, 200),
        amount: donation.amount,
      },
      success: false,
    });

    return ok({}, "실패 정보가 기록되었습니다");
  } catch (err) {
    console.error("[donate-toss-fail]", err);
    return serverError("실패 기록 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/donate-toss-fail" };