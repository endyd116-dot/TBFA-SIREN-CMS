/**
 * POST /api/donations/cancel
 * Body: { id }
 *
 * 정기 후원 해지 (사용자가 자기 본인의 정기 후원만 취소 가능)
 *
 * 보안 흐름:
 * 1. 로그인 검증
 * 2. 후원 ID 검증
 * 3. 본인 소유 확인 (memberId === auth.uid)
 * 4. 정기 후원만 취소 가능 (type='regular')
 * 5. 이미 취소/환불된 건 차단
 * 6. status='cancelled' + memo 기록
 * 7. 감사 로그
 *
 * 정책:
 * - 결제 완료된 회차의 환불은 별도 처리 (관리자 영역)
 * - 향후 결제 자동 중단 (정기결제 PG 연동 시 의미 있음)
 * - 한 번 cancelled 되면 사용자는 다시 활성화 불가 (재가입/재신청 필요)
 */
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, donations } from "../../db";
import { authenticateUser } from "../../lib/auth";
import { safeValidate } from "../../lib/validation";
import {
  ok, badRequest, unauthorized, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

const cancelSchema = z.object({
  id: z.number().int().positive("유효하지 않은 후원 ID"),
  reason: z.string().max(500).optional(),
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

    const donationId: number = v.data.id;
    const reason: string | undefined = v.data.reason;

    /* 3. 후원 조회 */
    const [donation] = await db
      .select()
      .from(donations)
      .where(eq(donations.id, donationId))
      .limit(1);

    if (!donation) return notFound("후원 내역을 찾을 수 없습니다");

    /* 4. 본인 소유 확인 */
    if (donation.memberId !== auth.uid) {
      await logUserAction(req, auth.uid, auth.name, "donation_cancel_denied", {
        target: `D-${donationId}`,
        detail: { reason: "not_owner" },
        success: false,
      });
      return forbidden("본인의 후원만 해지할 수 있습니다");
    }

    /* 5. 정기 후원만 취소 가능 */
    if (donation.type !== "regular") {
      return badRequest("정기 후원만 해지할 수 있습니다 (일시 후원은 환불 문의를 이용해 주세요)");
    }

    /* 6. 이미 취소/환불된 건 차단 */
    if (donation.status === "cancelled") {
      return badRequest("이미 해지된 후원입니다");
    }
    if (donation.status === "refunded") {
      return badRequest("이미 환불 처리된 후원입니다");
    }
    if (donation.status === "failed") {
      return badRequest("실패한 후원은 해지할 수 없습니다");
    }

    /* 7. status='cancelled' 처리 + memo 기록 */
    const now = new Date();
    const cancelMemo = reason
      ? `[자가 해지 ${now.toISOString().slice(0, 10)}] ${reason}`
      : `[자가 해지 ${now.toISOString().slice(0, 10)}]`;
    const newMemo = donation.memo
      ? `${donation.memo}\n${cancelMemo}`
      : cancelMemo;

    const updatePayload: any = {
      status: "cancelled",
      memo: newMemo,
      updatedAt: now,
    };

    const [updated] = await db
      .update(donations)
      .set(updatePayload)
      .where(eq(donations.id, donationId))
      .returning({
        id: donations.id,
        status: donations.status,
        type: donations.type,
        amount: donations.amount,
      });

    /* 8. 감사 로그 */
    await logUserAction(req, auth.uid, auth.name, "donation_cancel_success", {
      target: `D-${donationId}`,
      detail: {
        amount: updated.amount,
        type: updated.type,
        reasonProvided: !!reason,
      },
    });

    return ok(
      { donation: updated },
      "정기 후원이 해지되었습니다. 그동안 함께해 주셔서 감사합니다.",
    );
  } catch (err) {
    console.error("[donations-cancel]", err);
    return serverError("정기 후원 해지 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/donations/cancel" };