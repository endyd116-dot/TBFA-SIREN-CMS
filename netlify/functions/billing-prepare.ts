/**
 * POST /api/billing-prepare
 *
 * 토스 빌링키 발급 준비
 * - 프론트엔드가 토스 빌링키 등록창 호출 직전에 호출
 * - customerKey 생성 (UUID 또는 회원ID 기반)
 * - 후원 의도(amount, name 등)를 sessionStorage에서 임시 저장 → billing-confirm에서 사용
 * - 응답: customerKey
 *
 * 보안:
 * - 회원이면 회원ID를 customerKey 일부로 사용 (검증 강화)
 * - 비회원이면 random UUID
 * - amount/name 등은 다음 단계(billing-confirm)에서 다시 받음 (재검증)
 */
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";
import { db, members, billingKeys } from "../../db";
import { authenticateUser } from "../../lib/auth";
import { safeValidate } from "../../lib/validation";
import {
  ok, badRequest, forbidden, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

const prepareSchema = z.object({
  name: z.string().trim().min(2).max(50),
  phone: z.string().trim().regex(/^[0-9\-+\s()]{8,20}$/),
  email: z.string().trim().toLowerCase().email(),
  amount: z.number().int().min(1000).max(100_000_000),
  isAnonymous: z.boolean().optional().default(false),
});

/* ───────── customerKey 생성 ───────── */
function generateCustomerKey(memberId: number | null): string {
  /* 토스 customerKey 규격: 영문/숫자/-/_ , 2~50자
     - 회원: M{id}-{8자 hex}  (예: M42-a1b2c3d4)
     - 비회원: G-{16자 hex}   (Guest)
  */
  const rand = crypto.randomBytes(memberId ? 4 : 8).toString("hex");
  return memberId ? `M${memberId}-${rand}` : `G-${rand}`;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 입력 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v: any = safeValidate(prepareSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);

    const data = v.data;

    /* 2. 회원 식별 (선택적) */
    let memberId: number | null = null;
    let memberName: string | null = data.name;
    const auth = authenticateUser(req);
    if (auth) {
      const [user] = await db
        .select({
          id: members.id,
          name: members.name,
          email: members.email,
          status: members.status,
        })
        .from(members)
        .where(eq(members.id, auth.uid))
        .limit(1);

      if (user && user.status !== "withdrawn" && user.status !== "suspended") {
        memberId = user.id;
        memberName = user.name;

        /* 회원이 활성 빌링키를 이미 가지고 있으면 차단
           — 정기 후원은 1인당 1개만 (변경은 마이페이지에서 해지 후 재등록) */
        const [existingActive] = await db
          .select({ id: billingKeys.id, amount: billingKeys.amount })
          .from(billingKeys)
          .where(
            and(
              eq(billingKeys.memberId, user.id),
              eq(billingKeys.isActive, true),
            ),
          )
          .limit(1);

        if (existingActive) {
          return forbidden(
            `이미 활성화된 정기 후원이 있습니다 (월 ${existingActive.amount.toLocaleString()}원). ` +
            "변경하려면 마이페이지에서 먼저 해지 후 다시 등록해 주세요.",
          );
        }
      }
    }

    /* 3. customerKey 생성 (중복 방지 — 충돌 시 재시도) */
    let customerKey = "";
    let attempts = 0;
    while (attempts < 3) {
      customerKey = generateCustomerKey(memberId);
      const [existing] = await db
        .select({ id: billingKeys.id })
        .from(billingKeys)
        .where(eq(billingKeys.customerKey, customerKey))
        .limit(1);
      if (!existing) break;
      attempts++;
    }
    if (attempts >= 3) {
      throw new Error("customerKey 생성 실패");
    }

    /* 4. 감사 로그 */
    await logUserAction(req, memberId, memberName, "billing_prepare", {
      target: customerKey,
      detail: {
        amount: data.amount,
        memberId,
        isAnonymous: data.isAnonymous,
      },
    });

    /* 5. 응답
       — billing-confirm에서 다시 amount/name/email 받을 거라
         지금은 customerKey만 발급 */
    return ok({
      customerKey,
      memberIdent: memberId ? `M-${memberId}` : "GUEST",
    }, "빌링 준비 완료");
  } catch (err) {
    console.error("[billing-prepare]", err);
    return serverError("빌링 준비 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/billing-prepare" };