/**
 * POST /api/donate-toss-prepare
 *
 * 토스 일시 결제 준비 단계
 * - 프론트엔드가 토스 결제창 호출 직전에 호출
 * - orderId 발급 (TOSS-YYYY-MMxxxx 형식)
 * - donations 테이블에 pending 상태로 미리 INSERT
 * - 응답: orderId + donationId
 *
 * Body: {
 *   name, phone, email, amount,
 *   type: 'onetime',
 *   isAnonymous?: boolean,
 *   campaignTag?: string
 * }
 *
 * 보안:
 * - 비회원도 호출 가능 (회원이면 memberId 자동 연결)
 * - amount 1,000원 ~ 1억원 검증
 * - 이메일 형식 검증
 * - rate limit (IP 기반, 추후 추가 가능)
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, donations, members } from "../../db";
import { authenticateUser } from "../../lib/auth";
import { safeValidate } from "../../lib/validation";
import {
  ok, badRequest, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

/* ───────── 검증 스키마 ───────── */
const prepareSchema = z.object({
  name: z.string().trim().min(2, "이름은 2자 이상").max(50, "이름은 50자 이하"),
  phone: z.string().trim().regex(/^[0-9\-+\s()]{8,20}$/, "연락처 형식이 올바르지 않습니다"),
  email: z.string().trim().toLowerCase().email("이메일 형식이 올바르지 않습니다"),
  amount: z.number().int().min(1000, "최소 1,000원").max(100_000_000, "최대 1억원"),
  type: z.enum(["onetime", "regular"]).default("onetime"),
  isAnonymous: z.boolean().optional().default(false),
  campaignTag: z.string().max(50).optional(),
});

/* ───────── orderId 생성 헬퍼 ───────── */
function generateTossOrderId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  /* 8자리 랜덤 (소문자 + 숫자 — 토스는 영문/숫자/-/_만 허용, 6~64자) */
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let rand = "";
  for (let i = 0; i < 10; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  return `TOSS-${year}${month}-${rand}`;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    /* 1. 입력 파싱 + 검증 */
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v: any = safeValidate(prepareSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);

    const data = v.data;

    /* 2. 회원 식별 (선택적) — 로그인 사용자면 memberId 연결 */
    let memberId: number | null = null;
    let memberEmail: string | null = null;
    const auth = authenticateUser(req);
    if (auth) {
      const [user] = await db
        .select({
          id: members.id,
          email: members.email,
          status: members.status,
        })
        .from(members)
        .where(eq(members.id, auth.uid))
        .limit(1);

      if (user && user.status !== "withdrawn" && user.status !== "suspended") {
        memberId = user.id;
        memberEmail = user.email;
      }
    }

    /* 3. orderId 생성 (중복 방지를 위해 최대 3회 재시도) */
    let orderId = "";
    let attempts = 0;
    while (attempts < 3) {
      orderId = generateTossOrderId();
      const existing = await db
        .select({ id: donations.id })
        .from(donations)
        .where(eq(donations.tossOrderId, orderId))
        .limit(1);
      if (existing.length === 0) break;
      attempts++;
    }
    if (attempts >= 3) {
      throw new Error("주문번호 생성 실패");
    }

    /* 4. donations 테이블에 pending 상태로 INSERT */
    const insertPayload: any = {
      memberId,
      donorName: data.name,
      donorPhone: data.phone,
      donorEmail: data.email,
      amount: data.amount,
      type: data.type,
      payMethod: "card",  // 토스 카드
      pgProvider: "toss",
      status: "pending",
      tossOrderId: orderId,
      isAnonymous: data.isAnonymous === true,
      campaignTag: data.campaignTag || null,
    };

    const [donation] = await db
      .insert(donations)
      .values(insertPayload)
      .returning({
        id: donations.id,
        tossOrderId: donations.tossOrderId,
        amount: donations.amount,
      });

    if (!donation) {
      throw new Error("후원 정보 저장 실패");
    }

    /* 5. 감사 로그 */
    await logUserAction(req, memberId, data.name, "donate_toss_prepare", {
      target: orderId,
      detail: {
        amount: data.amount,
        type: data.type,
        donationId: donation.id,
        isAnonymous: data.isAnonymous,
      },
    });

    /* 6. 응답 — 프론트엔드가 토스 결제창 호출에 사용 */
    return ok({
      orderId: donation.tossOrderId,
      donationId: donation.id,
      amount: donation.amount,
    }, "결제 준비 완료");
  } catch (err) {
    console.error("[donate-toss-prepare]", err);
    return serverError("결제 준비 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/donate-toss-prepare" };
