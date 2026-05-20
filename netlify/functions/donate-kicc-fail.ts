/**
 * POST /api/donate-kicc-fail
 *
 * KICC 일시 결제 실패 기록 (프론트 fail 페이지 보조 호출 — 선택적).
 * - donations 행을 failed로 + 사유 기록 / 이미 completed면 무시(멱등)
 *
 * Body: { donationId, code?, message?, pgOrderNo? }
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, donations } from "../../db";
import { safeValidate } from "../../lib/validation";
import { ok, badRequest, notFound, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";
import { logUserAction } from "../../lib/audit";

const failSchema = z.object({
  donationId: z.number().int().positive(),
  code: z.string().max(100).optional(),
  message: z.string().max(500).optional(),
  pgOrderNo: z.string().max(64).optional(),
});

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v: any = safeValidate(failSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);
    const { donationId, code, message, pgOrderNo } = v.data;

    const [donation] = await db.select().from(donations).where(eq(donations.id, donationId)).limit(1);
    if (!donation) return notFound("주문 정보를 찾을 수 없습니다");

    if (donation.status === "completed") return ok({}, "이미 완료된 결제입니다 (변경 없음)");
    if (donation.status === "failed") return ok({}, "이미 실패 처리된 결제입니다");

    const reason = [code ? `[${code}]` : "", message || "사용자 취소 또는 결제창 종료"].filter(Boolean).join(" ");
    await db
      .update(donations)
      .set({ status: "failed", failureReason: reason.slice(0, 500), updatedAt: new Date() } as any)
      .where(eq(donations.id, donationId));

    await logUserAction(req, donation.memberId, donation.donorName, "donate_kicc_user_fail", {
      target: pgOrderNo || donation.pgOrderNo || `D-${donationId}`,
      detail: { donationId, code, message: message?.slice(0, 200), amount: donation.amount },
      success: false,
    });

    return ok({}, "실패 정보가 기록되었습니다");
  } catch (err) {
    console.error("[donate-kicc-fail]", err);
    return serverError("실패 기록 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/donate-kicc-fail" };
