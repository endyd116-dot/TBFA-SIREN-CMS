/**
 * POST /api/billing-register
 *
 * KICC 정기 후원 1단계 — 빌키 등록창(webpay, clientTypeCode=81).
 * - 회원 1인당 활성 빌키 1개 (중복 차단)
 * - customerKey(KICC 비종속 내부 회원-스코프 식별자) 생성
 * - donations 에 pending(type=regular) 선저장 → ★ 승인 시 서버 금액 기준
 * - KICC 거래등록 → authPageUrl(등록창) 반환
 *
 * Body: { name, phone, email, amount, isAnonymous? }
 * 응답: { authPageUrl, pgOrderNo, customerKey, memberIdent }
 */
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";
import { db, members, billingKeys, donations } from "../../db";
import { authenticateUser } from "../../lib/auth";
import { safeValidate } from "../../lib/validation";
import { ok, badRequest, forbidden, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";
import { logUserAction } from "../../lib/audit";
import { registerTrade, generateShopOrderNo } from "../../lib/kicc";

const SITE_URL = (process.env.SITE_URL || "https://tbfa.co.kr").replace(/\/+$/, "");

const registerSchema = z.object({
  name: z.string().trim().min(2).max(50),
  phone: z.string().trim().regex(/^[0-9\-+\s()]{8,20}$/),
  email: z.string().trim().toLowerCase().email(),
  amount: z.number().int().min(1000).max(100_000_000),
  isAnonymous: z.boolean().optional().default(false),
});

/** customerKey: 회원 M{id}-{8hex} / 비회원 G-{16hex} */
function generateCustomerKey(memberId: number | null): string {
  const rand = crypto.randomBytes(memberId ? 4 : 8).toString("hex");
  return memberId ? `M${memberId}-${rand}` : `G-${rand}`;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v: any = safeValidate(registerSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);
    const data = v.data;

    /* 회원 식별 + 활성 빌키 중복 차단 */
    let memberId: number | null = null;
    let memberName: string | null = data.name;
    const auth = authenticateUser(req);
    if (auth) {
      const [user] = await db
        .select({ id: members.id, name: members.name, status: members.status })
        .from(members)
        .where(eq(members.id, auth.uid))
        .limit(1);
      if (user && user.status !== "withdrawn" && user.status !== "suspended") {
        memberId = user.id;
        memberName = user.name;
        const [activeKey] = await db
          .select({ id: billingKeys.id, amount: billingKeys.amount })
          .from(billingKeys)
          .where(and(eq(billingKeys.memberId, user.id), eq(billingKeys.isActive, true)))
          .limit(1);
        if (activeKey) {
          return forbidden(
            `이미 활성화된 정기 후원이 있습니다 (월 ${activeKey.amount.toLocaleString()}원). ` +
              "변경하려면 마이페이지에서 먼저 해지 후 다시 등록해 주세요.",
          );
        }
      }
    }

    /* customerKey 생성 (중복 방지) */
    let customerKey = "";
    for (let i = 0; i < 3; i++) {
      customerKey = generateCustomerKey(memberId);
      const [dup] = await db.select({ id: billingKeys.id }).from(billingKeys).where(eq(billingKeys.customerKey, customerKey)).limit(1);
      if (!dup) break;
      if (i === 2) throw new Error("customerKey 생성 실패");
    }

    /* shopOrderNo(=pgOrderNo) 생성 */
    let pgOrderNo = "";
    for (let i = 0; i < 3; i++) {
      pgOrderNo = generateShopOrderNo("SIREN-REG");
      const [dup] = await db.select({ id: donations.id }).from(donations).where(eq(donations.pgOrderNo, pgOrderNo)).limit(1);
      if (!dup) break;
      if (i === 2) throw new Error("주문번호 생성 실패");
    }

    /* pending(type=regular) 선저장 — 승인 시 금액·기부자 서버 신뢰 기준 */
    await db.insert(donations).values({
      memberId,
      donorName: data.name,
      donorPhone: data.phone,
      donorEmail: data.email,
      amount: data.amount,
      type: "regular",
      payMethod: "card",
      pgProvider: "kicc",
      status: "pending",
      pgOrderNo,
      isAnonymous: data.isAnonymous === true,
    } as any);

    /* KICC 빌키 등록창 거래등록 */
    const reg = await registerTrade({
      shopOrderNo: pgOrderNo,
      amount: data.amount,
      goodsName: "교사유가족협의회 정기 후원",
      returnUrl: `${SITE_URL}/api/billing-approve`,
      clientTypeCode: "81", // 정기 빌키 등록
      customerName: data.name,
      customerEmail: data.email,
    });

    if (!reg.success || !reg.authPageUrl) {
      await db
        .update(donations)
        .set({ status: "failed", failureReason: (reg.errorMessage || "빌키 등록 준비 실패").slice(0, 500), updatedAt: new Date() } as any)
        .where(eq(donations.pgOrderNo, pgOrderNo));
      return badRequest(reg.errorMessage || "정기 후원 준비에 실패했습니다", { code: reg.errorCode });
    }

    await logUserAction(req, memberId, memberName, "billing_register", {
      target: pgOrderNo,
      detail: { amount: data.amount, customerKey, memberId },
    });

    return ok(
      { authPageUrl: reg.authPageUrl, pgOrderNo, customerKey, memberIdent: memberId ? `M-${memberId}` : "GUEST" },
      "정기 후원 준비 완료",
    );
  } catch (err) {
    console.error("[billing-register]", err);
    return serverError("정기 후원 준비 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/billing-register" };
