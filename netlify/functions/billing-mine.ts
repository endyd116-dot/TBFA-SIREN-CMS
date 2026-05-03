/**
 * GET /api/billing-mine
 *
 * 로그인 회원의 정기 후원(빌링키) 조회
 * - 본인 소유 빌링키만 반환
 * - 활성 + 비활성(최근 6개월) 모두 표시
 * - 카드 정보는 마스킹된 상태로 (PCI-DSS 준수)
 *
 * 응답:
 * {
 *   active: BillingKey | null,        // 현재 활성 정기 후원 (1개만)
 *   history: BillingKey[],            // 과거 해지 이력 (최근 6개월)
 *   recentCharges: Donation[],        // 최근 결제 이력 (최근 12건)
 *   stats: { totalAmount, totalCount, monthsActive }
 * }
 *
 * 보안:
 * - 로그인 필수
 * - 회원 본인 데이터만 (memberId 매칭)
 * - billingKey 자체는 응답에 포함 X (보안)
 */
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { db, billingKeys, donations, members } from "../../db";
import { authenticateUser } from "../../lib/auth";
import {
  ok, unauthorized, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    /* 1. 로그인 검증 */
    const auth = authenticateUser(req);
    if (!auth) return unauthorized("로그인이 필요합니다");

    /* 2. 회원 정보 검증 */
    const [user] = await db
      .select({ id: members.id, status: members.status })
      .from(members)
      .where(eq(members.id, auth.uid))
      .limit(1);

    if (!user) return unauthorized("회원 정보를 찾을 수 없습니다");
    if (user.status === "withdrawn" || user.status === "suspended") {
      return unauthorized("이용할 수 없는 계정입니다");
    }

    /* 3. 활성 빌링키 조회 (1인당 최대 1개) */
    const [activeBilling] = await db
      .select({
        id: billingKeys.id,
        cardCompany: billingKeys.cardCompany,
        cardNumberMasked: billingKeys.cardNumberMasked,
        cardType: billingKeys.cardType,
        amount: billingKeys.amount,
        isActive: billingKeys.isActive,
        nextChargeAt: billingKeys.nextChargeAt,
        lastChargedAt: billingKeys.lastChargedAt,
        consecutiveFailCount: billingKeys.consecutiveFailCount,
        lastFailureReason: billingKeys.lastFailureReason,
        createdAt: billingKeys.createdAt,
      })
      .from(billingKeys)
      .where(
        and(
          eq(billingKeys.memberId, user.id),
          eq(billingKeys.isActive, true),
        ),
      )
      .limit(1);

    /* 4. 비활성 이력 (최근 6개월) */
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const history = await db
      .select({
        id: billingKeys.id,
        cardCompany: billingKeys.cardCompany,
        cardNumberMasked: billingKeys.cardNumberMasked,
        amount: billingKeys.amount,
        deactivatedAt: billingKeys.deactivatedAt,
        deactivatedReason: billingKeys.deactivatedReason,
        createdAt: billingKeys.createdAt,
      })
      .from(billingKeys)
      .where(
        and(
          eq(billingKeys.memberId, user.id),
          eq(billingKeys.isActive, false),
          gte(billingKeys.deactivatedAt, sixMonthsAgo),
        ),
      )
      .orderBy(desc(billingKeys.deactivatedAt))
      .limit(10);

    /* 5. 최근 결제 이력 (최근 12건, 정기 후원만) */
    const recentCharges = await db
      .select({
        id: donations.id,
        amount: donations.amount,
        status: donations.status,
        billingKeyId: donations.billingKeyId,
        receiptNumber: donations.receiptNumber,
        failureReason: donations.failureReason,
        createdAt: donations.createdAt,
      })
      .from(donations)
      .where(
        and(
          eq(donations.memberId, user.id),
          eq(donations.type, "regular"),
          eq(donations.pgProvider, "toss"),
        ),
      )
      .orderBy(desc(donations.createdAt))
      .limit(12);

    /* 6. 통계 — 정기 후원 누적 (completed만) */
    const [stats] = await db
      .select({
        totalAmount: sql<number>`COALESCE(SUM(${donations.amount}), 0)`,
        totalCount: sql<number>`COUNT(*)`,
      })
      .from(donations)
      .where(
        and(
          eq(donations.memberId, user.id),
          eq(donations.type, "regular"),
          eq(donations.status, "completed"),
        ),
      );

    /* 7. 활성 기간 계산 (개월 수) */
    let monthsActive = 0;
    if (activeBilling) {
      const start = new Date(activeBilling.createdAt);
      const now = new Date();
      monthsActive =
        (now.getFullYear() - start.getFullYear()) * 12 +
        (now.getMonth() - start.getMonth());
      if (monthsActive < 0) monthsActive = 0;
    }

    return ok({
      active: activeBilling || null,
      history,
      recentCharges,
      stats: {
        totalAmount: Number(stats?.totalAmount ?? 0),
        totalCount: Number(stats?.totalCount ?? 0),
        monthsActive,
      },
    });
  } catch (err) {
    console.error("[billing-mine]", err);
    return serverError("정기 후원 조회 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/billing-mine" };