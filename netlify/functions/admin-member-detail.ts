/**
 * GET /api/admin/member-detail?id=N
 * 회원 종합 정보 (회원정보 + 후원 요약 + 지원 신청 요약 + ★ I-3 블랙/채팅메모)
 */
import { eq, desc, count, sql, and, isNotNull } from "drizzle-orm";
// netlify/functions/admin-member-detail.ts — import 라인 교체
import { db, members, donations, supportRequests, chatBlacklist, chatRooms } from "../../db";
import { memberGrades } from "../../db/schema";
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
// netlify/functions/admin-member-detail.ts — '1. 회원 기본 정보' 블록 교체
    /* 1. 회원 기본 정보 (★ M-19-1: 등급 정보 포함) */
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
        /* ★ M-19-1: 등급 정보 */
        gradeId: members.gradeId,
        gradeCode: memberGrades.code,
        gradeNameKo: memberGrades.nameKo,
        gradeIcon: memberGrades.icon,
        gradeColor: memberGrades.color,
        gradeAssignedAt: members.gradeAssignedAt,
        gradeLocked: members.gradeLocked,
        totalDonationAmount: members.totalDonationAmount,
        regularMonthsCount: members.regularMonthsCount,
      })
      .from(members)
      .leftJoin(memberGrades, eq(members.gradeId, memberGrades.id))
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

    /* ★ I-3: 4. 블랙리스트 상태 (활성 블랙만) */
    const [blackRow] = await db
      .select({
        id: chatBlacklist.id,
        reason: chatBlacklist.reason,
        blockedAt: chatBlacklist.blockedAt,
        blockedBy: chatBlacklist.blockedBy,
      })
      .from(chatBlacklist)
      .where(and(eq(chatBlacklist.memberId, id), eq(chatBlacklist.isActive, true)))
      .limit(1);

    let blackBlockedByName: string | null = null;
    if (blackRow && (blackRow as any).blockedBy) {
      const [b] = await db
        .select({ name: members.name })
        .from(members)
        .where(eq(members.id, (blackRow as any).blockedBy))
        .limit(1);
      if (b) blackBlockedByName = (b as any).name;
    }

    /* ★ I-3: 5. 해당 회원의 채팅방 중 관리자 메모가 있는 것들 */
    const chatMemos = await db
      .select({
        roomId: chatRooms.id,
        category: chatRooms.category,
        status: chatRooms.status,
        adminMemo: chatRooms.adminMemo,
        updatedAt: chatRooms.updatedAt,
        lastMessageAt: chatRooms.lastMessageAt,
      })
      .from(chatRooms)
      .where(and(eq(chatRooms.memberId, id), isNotNull(chatRooms.adminMemo)))
      .orderBy(desc(chatRooms.updatedAt))
      .limit(20);

    /* 메모가 빈 문자열인 경우 필터 */
    const filteredMemos = (chatMemos as any[]).filter(
      (m) => m.adminMemo && String(m.adminMemo).trim().length > 0
    );

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
      /* ★ I-3 신규 */
      blacklist: blackRow
        ? {
            id: (blackRow as any).id,
            reason: (blackRow as any).reason,
            blockedAt: (blackRow as any).blockedAt,
            blockedBy: (blackRow as any).blockedBy,
            blockedByName: blackBlockedByName,
          }
        : null,
      chatMemos: filteredMemos,
    });
  } catch (err) {
    console.error("[admin-member-detail]", err);
    return serverError("회원 상세 조회 중 오류", err);
  }
};

export const config = { path: "/api/admin/member-detail" };