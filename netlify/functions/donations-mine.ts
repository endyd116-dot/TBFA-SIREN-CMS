/**
 * GET /api/donations/mine
 * 로그인 사용자의 후원 내역 조회 (마이페이지용)
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { db, donations } from "../../db";
import { authenticateUser } from "../../lib/auth";
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

    /* 1. 후원 목록 */
    const list = await db
      .select({
        id: donations.id,
        amount: donations.amount,
        type: donations.type,
        payMethod: donations.payMethod,
        status: donations.status,
        receiptIssued: donations.receiptIssued,
        receiptNumber: donations.receiptNumber,           // ★ STEP H-2c 신규
        receiptIssuedAt: donations.receiptIssuedAt,       // ★ STEP H-2c 신규
        campaignTag: donations.campaignTag,
        createdAt: donations.createdAt,
      })
      .from(donations)
      .where(eq(donations.memberId, auth.uid))
      .orderBy(desc(donations.createdAt))
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

    return ok({
      list: list.map(d => ({
        id: d.id,
        donationNo: `D-${String(d.id).padStart(7, "0")}`,
        amount: d.amount,
        type: d.type,
        payMethod: d.payMethod,
        status: d.status,
        receiptIssued: d.receiptIssued,
        receiptNumber: d.receiptNumber,                   // ★ STEP H-2c 신규
        receiptIssuedAt: d.receiptIssuedAt,               // ★ STEP H-2c 신규
        campaignTag: d.campaignTag,
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