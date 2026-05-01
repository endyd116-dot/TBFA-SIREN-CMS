/**
 * GET /api/admin/me
 * 관리자 세션 확인 + 대시보드 KPI 조회
 */
import { count, sql, and, eq, gte } from "drizzle-orm";
import { db, members, donations, supportRequests } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.res;

  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    /* KPI: 금월 후원금, 신규 정기후원, 대기 중 지원, 전체 회원 */
    const [donStats] = await db
      .select({
        totalAmount: sql<number>`COALESCE(SUM(${donations.amount}), 0)`,
        count: count(),
      })
      .from(donations)
      .where(
        and(
          eq(donations.status, "completed"),
          gte(donations.createdAt, startOfMonth)
        )
      );

    const [newRegular] = await db
      .select({ c: count() })
      .from(donations)
      .where(
        and(
          eq(donations.type, "regular"),
          eq(donations.status, "completed"),
          gte(donations.createdAt, startOfMonth)
        )
      );

    const [pendingSupport] = await db
      .select({ c: count() })
      .from(supportRequests)
      .where(eq(supportRequests.status, "submitted"));

    const [totalMembers] = await db
      .select({ c: count() })
      .from(members);

    return ok({
      admin: {
        id: guard.ctx.member.id,
        email: guard.ctx.member.email,
        name: guard.ctx.member.name,
        role: "super_admin",
      },
      kpi: {
        monthlyDonation: Number(donStats?.totalAmount ?? 0),
        monthlyDonationCount: Number(donStats?.count ?? 0),
        newRegularCount: Number(newRegular?.c ?? 0),
        pendingSupportCount: Number(pendingSupport?.c ?? 0),
        totalMembers: Number(totalMembers?.c ?? 0),
      },
    });
  } catch (err) {
    console.error("[admin-me]", err);
    return serverError("관리자 정보 조회 중 오류", err);
  }
};

export const config = { path: "/api/admin/me" };