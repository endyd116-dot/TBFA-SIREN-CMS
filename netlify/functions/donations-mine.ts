/**
 * GET /api/donations/mine
 * 로그인 사용자의 후원 내역 조회 (마이페이지용)
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { db, donations } from "../../db";
import { authenticateUser } from "../../lib/auth";
import { computeAutoStage, onetimeValidUntil } from "../../lib/donor-stage";
import {
  ok, unauthorized, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const auth = authenticateUser(req);
    if (!auth) return unauthorized("로그인이 필요합니다");

    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);
    const offset = Number(url.searchParams.get("offset") || 0);

    /* 1. 후원 목록
       Q12: 마이페이지에 표시되는 후원 날짜는 실제 결제일 (효성 CMS는 hyosungPaidDate, 그 외 채널은 createdAt) */
    const list = await db
      .select({
        id: donations.id,
        amount: donations.amount,
        type: donations.type,
        payMethod: donations.payMethod,
        status: donations.status,
        receiptIssued: donations.receiptIssued,
        receiptNumber: donations.receiptNumber,           // STEP H-2c 신규
        receiptIssuedAt: donations.receiptIssuedAt,       // STEP H-2c 신규
        campaignTag: donations.campaignTag,
        createdAt: donations.createdAt,
        hyosungPaidDate: donations.hyosungPaidDate,
      })
      .from(donations)
      .where(eq(donations.memberId, auth.uid))
      .orderBy(sql`COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt}) DESC`)
      .limit(limit)
      .offset(offset);

    /* 2. 통계 (완료된 후원만) */
    const [stats] = await db
      .select({
        totalAmount: sql<number>`COALESCE(SUM(${donations.amount}), 0)`,
        regularCount: sql<number>`COUNT(*) FILTER (WHERE ${donations.type} = 'regular')`,
        onetimeCount: sql<number>`COUNT(*) FILTER (WHERE ${donations.type} = 'onetime')`,
        totalCount: sql<number>`COUNT(*)`,
      })
      .from(donations)
      .where(
        and(
          eq(donations.memberId, auth.uid),
          eq(donations.status, "completed")
        )
      );

    /* 3. 회원 자격 (2026-11-08 회비 규칙): 정기 = 매월 납부하는 동안, 일시 = 마지막 납부일부터 1년. 계산이 실패해도 내역은 보여 준다 */
    let membership: { kind: "regular" | "onetime" | "expired"; validUntil: string | null } | null = null;
    try {
      const auto = await computeAutoStage(auth.uid);
      if (auto?.stage === "regular") membership = { kind: "regular", validUntil: null };
      else if (auto?.stage === "prospect_onetime" && auto.signals.lastPaid) membership = { kind: "onetime", validUntil: onetimeValidUntil(auto.signals.lastPaid) };
      else if (auto && auto.signals.onetimeCount > 0 && auto.signals.lastPaid) membership = { kind: "expired", validUntil: onetimeValidUntil(auto.signals.lastPaid) };
    } catch (err) {
      console.warn("[donations-mine] 회원 자격 계산 실패(내역만 응답):", err);
    }

    return ok({
      membership,
      list: list.map(d => ({
        id: d.id,
        donationNo: `D-${String(d.id).padStart(7, "0")}`,
        amount: d.amount,
        type: d.type,
        payMethod: d.payMethod,
        status: d.status,
        receiptIssued: d.receiptIssued,
        receiptNumber: d.receiptNumber,                   // STEP H-2c 신규
        receiptIssuedAt: d.receiptIssuedAt,               // STEP H-2c 신규
        campaignTag: d.campaignTag,
        /* Q12: paidDate는 표시용 결제일 (효성은 자료의 실제 결제일, 그 외는 createdAt) */
        paidDate: (d as any).hyosungPaidDate ?? d.createdAt,
        createdAt: d.createdAt,
      })),
      stats: {
        totalAmount: Number(stats?.totalAmount ?? 0),
        regularCount: Number(stats?.regularCount ?? 0),
        onetimeCount: Number(stats?.onetimeCount ?? 0),
        totalCount: Number(stats?.totalCount ?? 0),
      },
    });
  } catch (err) {
    console.error("[donations-mine]", err);
    return serverError("후원 내역 조회 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/donations/mine" };