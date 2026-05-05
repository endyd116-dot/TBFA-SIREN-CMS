// netlify/functions/admin-experts-for-match.ts
// ★ Phase M-19-11 V2: 법률/심리 상담 매칭용 전문가 목록 (members 기반)
//
// GET /api/admin/experts-for-match?type=lawyer|counselor
//
// 권한: super_admin 또는 'all'/'legal' 카테고리 담당자
// 반환: 활성+승인 완료된 변호사/심리상담사 회원 (members.status='active')
//
// V1 차이: expert_profiles 테이블 사용 → members 테이블 직접 조회로 변경

import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db";
import { members } from "../../db/schema";
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

  /* 권한: super_admin 또는 'all'/'legal' 카테고리 담당 */
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

    /* ★ V2: members 테이블 직접 조회
       조건: type='volunteer' AND member_subtype=type AND status='active'
             AND secondary_verified=true (관리자 승인 완료) */
    const experts = await db
      .select({
        id: members.id,
        memberId: members.id,
        name: members.name,
        email: members.email,
        phone: members.phone,
        memberSubtype: members.memberSubtype,
        certificateVerifiedAt: members.certificateVerifiedAt,
        secondaryVerifiedAt: members.secondaryVerifiedAt,
        memo: members.memo,
        createdAt: members.createdAt,
      })
      .from(members)
      .where(and(
        eq(members.type, "volunteer"),
        eq(members.memberSubtype, type),
        eq(members.status, "active"),
        sql`${members.secondaryVerified} = true`,
      ));

    /* 응답 형태: V1 호환 + V2 메타 */
    const formatted = experts.map((m: any) => ({
      id: m.id,
      memberId: m.memberId,
      expertType: m.memberSubtype,
      memberName: m.name,
      memberEmail: m.email,
      memberPhone: m.phone,
      /* V1 잔재 필드는 null/0 으로 (호환용) */
      specialty: null,
      affiliation: null,
      yearsOfExperience: 0,
      preferredArea: null,
      maxConcurrentCases: 5,
      totalCasesHandled: 0,
      totalCasesCompleted: 0,
      /* V2 신규 필드 */
      verifiedAt: m.secondaryVerifiedAt || m.certificateVerifiedAt,
      memo: m.memo,
      createdAt: m.createdAt,
    }));

    return ok({
      experts: formatted,
      count: formatted.length,
    });
  } catch (err: any) {
    console.error("[admin-experts-for-match V2]", err);
    return serverError("전문가 목록 조회 실패", err?.message);
  }
};

export const config = { path: "/api/admin/experts-for-match" };