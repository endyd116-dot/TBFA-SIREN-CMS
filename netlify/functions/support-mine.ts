/**
 * GET /api/support/mine
 * 로그인 사용자의 지원 신청 내역 조회 (마이페이지 1:1 상담 탭)
 */
import { eq, desc } from "drizzle-orm";
import { db, supportRequests } from "../../db";
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

    const list = await db
      .select({
        id: supportRequests.id,
        requestNo: supportRequests.requestNo,
        category: supportRequests.category,
        title: supportRequests.title,
        status: supportRequests.status,
        assignedExpertName: supportRequests.assignedExpertName,
        adminNote: supportRequests.adminNote,
        supplementNote: supportRequests.supplementNote,
        createdAt: supportRequests.createdAt,
        completedAt: supportRequests.completedAt,
      })
      .from(supportRequests)
      .where(eq(supportRequests.memberId, auth.uid))
      .orderBy(desc(supportRequests.createdAt))
      .limit(limit);

    return ok({ list });
  } catch (err) {
    console.error("[support-mine]", err);
    return serverError("신청 내역 조회 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/support/mine" };