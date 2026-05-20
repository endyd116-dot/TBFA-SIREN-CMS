/**
 * POST /api/donate-kicc-register
 *
 * KICC 일시 결제 1단계 — 거래등록(webpay).
 * - 프론트가 결제 직전 호출
 * - donations 에 pending 레코드 선저장(금액·기부자·customerKey 상관) → ★ 승인 시 서버 신뢰 기준
 * - KICC 거래등록 → authPageUrl 반환 → 프론트가 결제창으로 이동
 *
 * Body: { name, phone, email, amount, type?, isAnonymous?, campaignId?, campaignTag? }
 * 응답: { authPageUrl, pgOrderNo, donationId, amount }
 *
 * 보안: returnUrl = 백엔드 핸들러(/api/donate-kicc-approve). 승인은 register 때 저장한 금액 기준.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, donations, members } from "../../db";
import { authenticateUser } from "../../lib/auth";
import { safeValidate } from "../../lib/validation";
import { ok, badRequest, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";
import { logUserAction } from "../../lib/audit";
import { registerTrade, generateShopOrderNo } from "../../lib/kicc";

const SITE_URL = (process.env.SITE_URL || "https://tbfa.co.kr").replace(/\/+$/, "");

const registerSchema = z.object({
  name: z.string().trim().min(2, "이름은 2자 이상").max(50, "이름은 50자 이하"),
  phone: z.string().trim().regex(/^[0-9\-+\s()]{8,20}$/, "연락처 형식이 올바르지 않습니다"),
  email: z.string().trim().toLowerCase().email("이메일 형식이 올바르지 않습니다"),
  amount: z.number().int().min(1000, "최소 1,000원").max(100_000_000, "최대 1억원"),
  type: z.enum(["onetime", "regular"]).default("onetime"),
  isAnonymous: z.boolean().optional().default(false),
  campaignId: z.number().int().positive().optional(),
  campaignTag: z.string().max(50).optional(),
});

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const v: any = safeValidate(registerSchema, body);
    if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);
    const data = v.data;

    /* 회원 식별 (선택적) */
    let memberId: number | null = null;
    const auth = authenticateUser(req);
    if (auth) {
      const [user] = await db
        .select({ id: members.id, status: members.status })
        .from(members)
        .where(eq(members.id, auth.uid))
        .limit(1);
      if (user && user.status !== "withdrawn" && user.status !== "suspended") memberId = user.id;
    }

    /* shopOrderNo(=pgOrderNo) 생성 (중복 방지) */
    let pgOrderNo = "";
    for (let i = 0; i < 3; i++) {
      pgOrderNo = generateShopOrderNo("SIREN");
      const [dup] = await db
        .select({ id: donations.id })
        .from(donations)
        .where(eq(donations.pgOrderNo, pgOrderNo))
        .limit(1);
      if (!dup) break;
      if (i === 2) throw new Error("주문번호 생성 실패");
    }

    /* pending 레코드 선저장 — ★ 승인 시 금액·기부자 서버 신뢰 기준
       캠페인 합산 키는 campaignId(숫자 FK). campaignTag는 레거시(보조 저장만). */
    const [donation] = await db
      .insert(donations)
      .values({
        memberId,
        donorName: data.name,
        donorPhone: data.phone,
        donorEmail: data.email,
        amount: data.amount,
        type: data.type,
        payMethod: "card",
        pgProvider: "kicc",
        status: "pending",
        pgOrderNo,
        campaignId: data.campaignId ?? null,
        campaignTag: data.campaignTag || null,
        isAnonymous: data.isAnonymous === true,
      } as any)
      .returning({ id: donations.id, pgOrderNo: donations.pgOrderNo, amount: donations.amount });
    if (!donation) throw new Error("후원 정보 저장 실패");

    /* KICC 거래등록 */
    const reg = await registerTrade({
      shopOrderNo: pgOrderNo,
      amount: data.amount,
      goodsName: "교사유가족협의회 후원",
      returnUrl: `${SITE_URL}/api/donate-kicc-approve`,
      clientTypeCode: "0030", // PC 표준결제창
      customerName: data.name,
      customerEmail: data.email,
    });

    if (!reg.success || !reg.authPageUrl) {
      await db
        .update(donations)
        .set({ status: "failed", failureReason: (reg.errorMessage || "거래등록 실패").slice(0, 500), updatedAt: new Date() } as any)
        .where(eq(donations.id, donation.id));
      return badRequest(reg.errorMessage || "결제 준비에 실패했습니다", { code: reg.errorCode });
    }

    await logUserAction(req, memberId, data.name, "donate_kicc_register", {
      target: pgOrderNo,
      detail: { amount: data.amount, donationId: donation.id, type: data.type },
    });

    return ok(
      { authPageUrl: reg.authPageUrl, pgOrderNo, donationId: donation.id, amount: donation.amount },
      "결제 준비 완료",
    );
  } catch (err) {
    console.error("[donate-kicc-register]", err);
    return serverError("결제 준비 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/donate-kicc-register" };
