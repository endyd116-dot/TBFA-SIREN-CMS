/**
 * GET /api/auth/me
 * 현재 로그인 사용자 정보 조회 (세션 유효성 확인용)
 * - 토큰 없거나 만료 → 401
 * - 토큰 유효 → 회원 정보 + 후원 통계 반환
 */
import { eq, sql, and } from "drizzle-orm";
import { db, members, donations } from "../../db";
import { authenticateUser } from "../../lib/auth";
import {
  ok, unauthorized, notFound, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    /* 1. 토큰 검증 */
    const auth = authenticateUser(req);
    if (!auth) return unauthorized("로그인이 필요합니다");

    /* 2. DB에서 최신 회원 정보 조회 */
    const [user] = await db
      .select({
        id: members.id,
        email: members.email,
        name: members.name,
        phone: members.phone,
        type: members.type,
        status: members.status,
        agreeEmail: members.agreeEmail,
        agreeSms: members.agreeSms,
        agreeMail: members.agreeMail,
        lastLoginAt: members.lastLoginAt,
        createdAt: members.createdAt,
      })
      .from(members)
      .where(eq(members.id, auth.uid))
      .limit(1);

    if (!user) return notFound("회원 정보를 찾을 수 없습니다");

    /* 3. 회원 상태 확인 */
    if (user.status === "suspended" || user.status === "withdrawn") {
      return unauthorized("이용할 수 없는 계정입니다");
    }

    /* 4. 후원 통계 (마이페이지 카드용) */
    const [stats] = await db
      .select({
        totalAmount: sql<number>`COALESCE(SUM(${donations.amount}), 0)`,
        regularCount: sql<number>`COUNT(*) FILTER (WHERE ${donations.type} = 'regular')`,
        totalCount: sql<number>`COUNT(*)`,
      })
      .from(donations)
      .where(
        and(
          eq(donations.memberId, user.id),
          eq(donations.status, "completed")
        )
      );

    /* 5. 응답 */
    return ok({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        type: user.type,
        status: user.status,
        agreeEmail: user.agreeEmail,
        agreeSms: user.agreeSms,
        agreeMail: user.agreeMail,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      },
      stats: {
        totalAmount: Number(stats?.totalAmount ?? 0),
        regularCount: Number(stats?.regularCount ?? 0),
        totalCount: Number(stats?.totalCount ?? 0),
      },
    });
  } catch (err) {
    console.error("[auth-me]", err);
    return serverError("사용자 정보 조회 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/auth/me" };