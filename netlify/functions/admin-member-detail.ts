/**
 * GET /api/admin/member-detail?id=N
 * 회원 종합 정보 (회원정보 + 후원 요약 + 지원 신청 요약)
 */
import { eq, desc, count, sql } from "drizzle-orm";
import { db, members, donations, supportRequests } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;

  try {
    const url = new URL(req.url);
    const idStr = url.searchParams.get("id");
    if (!idStr) return badRequest("id가 필요합니다");

    const id = Number(idStr);
    if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

    /* 1. 회원 기본 정보 */
    const [member] = await db
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
        emailVerified: members.emailVerified,
        lastLoginAt: members.lastLoginAt,
        createdAt: members.createdAt,
        memo: members.memo,
      })
      .from(members)
      .where(eq(members.id, id))
      .limit(1);

    if (!member) return notFound("회원을 찾을 수 없습니다");

    /* 2. 후원 요약 */
    const [donationStats] = await db
      .select({
        totalAmount: sql<number>`COALESCE(SUM(${donations.amount}), 0)`,
        totalCount: count(),
      })
      .from(donations)
      .where(
        sql`${donations.memberId} = ${id} AND ${donations.status} = 'completed'`
      );

    const recentDonations = await db
      .select({
        id: donations.id,
        amount: donations.amount,
        type: donations.type,
        status: donations.status,
        createdAt: donations.createdAt,
      })
      .from(donations)
      .where(eq(donations.memberId, id))
      .orderBy(desc(donations.createdAt))
      .limit(5);

    /* 3. 지원 신청 요약 */
    const supportList = await db
      .select({
        id: supportRequests.id,
        requestNo: supportRequests.requestNo,
        category: supportRequests.category,
        title: supportRequests.title,
        status: supportRequests.status,
        createdAt: supportRequests.createdAt,
      })
      .from(supportRequests)
      .where(eq(supportRequests.memberId, id))
      .orderBy(desc(supportRequests.createdAt))
      .limit(10);

    const supportInProgress = supportList.filter((s) =>
      ["submitted", "reviewing", "supplement", "matched", "in_progress"].includes(s.status)
    ).length;
    const supportCompleted = supportList.filter((s) => s.status === "completed").length;

    return ok({
      member,
      donationSummary: {
        totalAmount: Number(donationStats?.totalAmount ?? 0),
        totalCount: Number(donationStats?.totalCount ?? 0),
        recent: recentDonations,
      },
      supportSummary: {
        total: supportList.length,
        inProgress: supportInProgress,
        completed: supportCompleted,
        list: supportList,
      },
    });
  } catch (err) {
    console.error("[admin-member-detail]", err);
    return serverError("회원 상세 조회 중 오류", err);
  }
};

export const config = { path: "/api/admin/member-detail" };