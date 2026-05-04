// netlify/functions/admin-experts-for-match.ts
// ★ Phase M-19-11: 법률/심리 상담 매칭용 등록 전문가 목록
//
// GET /api/admin/experts-for-match?type=lawyer|counselor
//
// 권한: super_admin 또는 'all' 카테고리 담당자
// 반환: 승인+활성+매칭가능 상태의 전문가만

import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { expertProfiles, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { member: adminMember } = guard.ctx;

  if (adminMember.role !== "super_admin") {
    const cats: string[] = Array.isArray(adminMember.assignedCategories)
      ? adminMember.assignedCategories : [];
    if (!cats.includes("all") && !cats.includes("legal")) {
      return forbidden("전문가 목록 조회 권한이 없습니다");
    }
  }

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type");

    if (type !== "lawyer" && type !== "counselor") {
      return badRequest("type 파라미터가 필요합니다 (lawyer 또는 counselor)");
    }

    const experts = await db
      .select({
        id: expertProfiles.id,
        memberId: expertProfiles.memberId,
        expertType: expertProfiles.expertType,
        specialty: expertProfiles.specialty,
        affiliation: expertProfiles.affiliation,
        yearsOfExperience: expertProfiles.yearsOfExperience,
        preferredArea: expertProfiles.preferredArea,
        maxConcurrentCases: expertProfiles.maxConcurrentCases,
        totalCasesHandled: expertProfiles.totalCasesHandled,
        totalCasesCompleted: expertProfiles.totalCasesCompleted,
        memberName: members.name,
        memberEmail: members.email,
        memberPhone: members.phone,
      })
      .from(expertProfiles)
      .innerJoin(members, eq(expertProfiles.memberId, members.id))
      .where(and(
        eq(expertProfiles.expertType, type as any),
        eq(expertProfiles.expertStatus, "approved"),
        eq(expertProfiles.isMatchable, true),
        eq(members.status, "active"),
      ));

    return ok({
      experts,
      count: experts.length,
    });
  } catch (err: any) {
    console.error("[admin-experts-for-match]", err);
    return serverError("전문가 목록 조회 실패", err?.message);
  }
};

export const config = { path: "/api/admin/experts-for-match" };