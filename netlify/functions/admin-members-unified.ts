import type { Context } from "@netlify/functions";
import { db } from "../../db";
import {
  members,
  memberGrades,
  donations,
  eligibilityChangeRequests,
} from "../../db/schema";
import { eq, like, or, desc, asc, sql, and, inArray } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok } from "../../lib/response";

export const config = { path: "/api/admin-members-unified" };

// 공통 에러 응답
function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false,
    error: "회원 통합 조회 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const auth: any = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const page      = Math.max(parseInt(url.searchParams.get("page")  || "1",  10), 1);
  const pageSize  = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset    = (page - 1) * pageSize;
  const search    = (url.searchParams.get("search") || "").trim();
  const typeFilter   = url.searchParams.get("type")   || "";
  const statusFilter = url.searchParams.get("status") || "";

  // ── 회원 목록 ────────────────────────────────────────────
  let memberRows: any[] = [];
  let totalCount = 0;
  try {
    const conditions: any[] = [];
    if (search) {
      conditions.push(or(
        like(members.name,  `%${search}%`),
        like(members.email, `%${search}%`),
        like(members.phone, `%${search}%`),
      ));
    }
    if (typeFilter)   conditions.push(eq(members.type,   typeFilter as any));
    if (statusFilter) conditions.push(eq(members.status, statusFilter as any));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const countRes: any = await db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(members)
      .where(whereClause);
    totalCount = Number(countRes[0]?.cnt ?? 0);

    memberRows = await db
      .select({
        id:             members.id,
        name:           members.name,
        email:          members.email,
        phone:          members.phone,
        type:           members.type,
        status:         members.status,
        role:           members.role,
        memberCategory: members.memberCategory,
        gradeId:        members.gradeId,
        donorType:      members.donorType,
        blacklistedAt:  members.blacklistedAt,
        createdAt:      members.createdAt,
        lastLoginAt:    members.lastLoginAt,
        totalDonationAmount: members.totalDonationAmount,
        regularMonthsCount:  members.regularMonthsCount,
        churnRiskLevel:      members.churnRiskLevel,
      })
      .from(members)
      .where(whereClause)
      .orderBy(desc(members.createdAt))
      .limit(pageSize)
      .offset(offset);
  } catch (err) {
    return jsonError("select_members", err);
  }

  // ── 등급 정보 (separate query) ────────────────────────────
  const gradeMap = new Map<number, any>();
  try {
    const gradeIds = [...new Set(memberRows.map((m) => m.gradeId).filter(Boolean))] as number[];
    if (gradeIds.length > 0) {
      const gradeRows = await db
        .select({ id: memberGrades.id, code: memberGrades.code, nameKo: memberGrades.nameKo, icon: memberGrades.icon, colorHex: memberGrades.colorHex })
        .from(memberGrades)
        .where(inArray(memberGrades.id, gradeIds));
      for (const g of gradeRows) gradeMap.set(g.id, g);
    }
  } catch (err) {
    console.warn("[admin-members-unified] memberGrades 조회 실패:", (err as any)?.message);
  }

  // ── 운영자(role 있는 회원) 목록 ───────────────────────────
  let operators: any[] = [];
  try {
    operators = await db
      .select({
        id:              members.id,
        name:            members.name,
        email:           members.email,
        role:            members.role,
        operatorActive:  members.operatorActive,
        notifyOnSupport: members.notifyOnSupport,
        assignedCategories: members.assignedCategories,
        lastLoginAt:     members.lastLoginAt,
      })
      .from(members)
      .where(sql`${members.role} IS NOT NULL AND ${members.role} != ''`)
      .orderBy(asc(members.name));
  } catch (err) {
    console.warn("[admin-members-unified] operators 조회 실패:", (err as any)?.message);
  }

  // ── 자격 변경 신청 목록 ───────────────────────────────────
  let eligibility: any[] = [];
  try {
    const eligRows = await db
      .select({
        id:            eligibilityChangeRequests.id,
        memberId:      eligibilityChangeRequests.memberId,
        currentType:   eligibilityChangeRequests.currentType,
        requestedType: eligibilityChangeRequests.requestedType,
        status:        eligibilityChangeRequests.status,
        reason:        eligibilityChangeRequests.reason,
        createdAt:     eligibilityChangeRequests.createdAt,
      })
      .from(eligibilityChangeRequests)
      .where(eq(eligibilityChangeRequests.status, "pending"))
      .orderBy(desc(eligibilityChangeRequests.createdAt))
      .limit(100);

    // 신청자 이름·이메일 별도 조회 (separate query + Map 매칭)
    const eligMemberIds = [...new Set(eligRows.map((e) => e.memberId).filter(Boolean))] as number[];
    const eligMemberMap = new Map<number, { name: string; email: string }>();
    if (eligMemberIds.length > 0) {
      try {
        const nameRows = await db
          .select({ id: members.id, name: members.name, email: members.email })
          .from(members)
          .where(inArray(members.id, eligMemberIds));
        for (const m of nameRows) eligMemberMap.set(m.id, { name: m.name, email: m.email });
      } catch { /* 보조 조회 실패 시 빈 이름으로 진행 */ }
    }

    eligibility = eligRows.map((e) => ({
      ...e,
      memberName:  eligMemberMap.get(e.memberId)?.name  ?? "(알 수 없음)",
      memberEmail: eligMemberMap.get(e.memberId)?.email ?? "-",
    }));
  } catch (err) {
    console.warn("[admin-members-unified] eligibility 조회 실패:", (err as any)?.message);
  }

  // ── 응답 조립 ─────────────────────────────────────────────
  const enrichedMembers = memberRows.map((m) => ({
    ...m,
    grade: m.gradeId ? (gradeMap.get(m.gradeId) ?? null) : null,
  }));

  return ok({
    members:      enrichedMembers,
    operators,
    eligibility,
    totalCount,
    page,
    pageSize,
  });
}
