/**
 * POST /api/donate
 * 후원 처리 — 비회원/회원 모두 가능, 회원이면 memberId 자동 연결
 */
import { db, donations, generateTransactionId } from "../../db";
import { authenticateUser } from "../../lib/auth";
import { donateSchema, safeValidate } from "../../lib/validation";
import {
  created, badRequest, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 입력 파싱 + 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v = safeValidate(donateSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해주세요", v.errors);

    const { name, phone, email, amount, type, payMethod, isAnonymous, campaignTag } = v.data;

    /* 2. 로그인 사용자면 자동 연결 */
    const auth = authenticateUser(req);
    const memberId = auth?.uid ?? null;

    /* 3. 결제 처리 시뮬레이션
       - 실제 PG사 연동 시 여기서 토스페이먼츠/아임포트 호출
       - 지금은 즉시 completed 처리 (95% 성공률 시뮬) */
    const transactionId = generateTransactionId();
    const status = Math.random() > 0.05 ? "completed" : "failed";

    /* 4. DB 저장 */
    const [record] = await db
      .insert(donations)
      .values({
        memberId,
        donorName: name,
        donorPhone: phone,
        donorEmail: email || null,
        amount,
        type,
        payMethod,
        status,
        transactionId,
        pgProvider: payMethod === "card" ? "toss" : payMethod === "cms" ? "kcp" : "manual",
        isAnonymous: isAnonymous ?? false,
        campaignTag: campaignTag || null,
        receiptRequested: !!email,
      })
      .returning();

    /* 5. 감사 로그 */
    await logUserAction(req, memberId, name, "donate", {
      target: `D-${record.id}`,
      detail: { amount, type, payMethod, status },
      success: status === "completed",
    });

    /* 6. 응답 */
    if (status !== "completed") {
      return badRequest("결제가 실패했습니다. 다시 시도해주세요.", { transactionId });
    }

    return created(
      {
        donationId: `D-${String(record.id).padStart(7, "0")}`,
        transactionId,
        amount,
        type,
        memberId,
      },
      "후원이 완료되었습니다. 감사합니다 :)"
    );
  } catch (err) {
    console.error("[donate]", err);
    return serverError("후원 처리 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/donate" };