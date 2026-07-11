/**
 * GET /api/auth/me
 * 현재 로그인 사용자 정보 조회 (세션 유효성 확인용)
 * - 토큰 없거나 만료 → 401
 * - 토큰 유효 → 회원 정보 + 후원 통계 반환
 *
 * K-2 패치: emailVerified 필드 응답에 추가
 *   - mypage.html의 이메일 인증 배너 갱신용
 */
import { eq, sql, and } from "drizzle-orm";
import { db, members, donations } from "../../db";
import { authenticateUser } from "../../lib/auth";
import {
  ok, unauthorized, notFound, serverError, badRequest,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { profileUpdateSchema } from "../../lib/validation";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method === "PATCH") return handlePatch(req);   /* US-007: 회원정보 저장 */
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
        role: members.role,                     /* 슈퍼어드민·관리자 식별 */
        milestoneRole: members.milestoneRole,   /* 성과 담당 역할 SM/PM/SI */
        status: members.status,
        emailVerified: members.emailVerified,  /* K-2 추가 */
        agreeEmail: members.agreeEmail,
        agreeSms: members.agreeSms,
        agreeMail: members.agreeMail,
        operatorActive: members.operatorActive, /* 운영자 토글 */
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

    /* 5. 응답 — admin/operator 식별 필드 포함 */
    const isAdmin    = user.type === "admin";
    const isOperator = (user as any).operatorActive === true;
    return ok({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        type: user.type,
        role: user.role,                       /* 'super_admin'·'admin'·기타 */
        milestoneRole: user.milestoneRole,     /* SM/PM/SI 또는 null */
        operatorActive: user.operatorActive,   /* 운영자 토글 (workspace 진입 판정용) */
        status: user.status,
        emailVerified: user.emailVerified,  /* K-2 추가 */
        agreeEmail: user.agreeEmail,
        agreeSms: user.agreeSms,
        agreeMail: user.agreeMail,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        isAdmin,
        isOperator,
        canAdminMode: isAdmin || isOperator,
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

/* US-007: 마이페이지 회원정보(이름·연락처·알림동의) 저장
   기존엔 PATCH 핸들러가 없어 mypage의 PATCH /api/auth/me 가 항상 405였음(죽은 기능). */
async function handlePatch(req: Request) {
  try {
    const auth = authenticateUser(req);
    if (!auth) return unauthorized("로그인이 필요합니다");

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const parsed = profileUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message || "입력값이 올바르지 않습니다");
    }
    const d = parsed.data;

    /* 본인 활성 계정 확인 (정지·탈퇴 차단) */
    const [cur] = await db
      .select({ status: members.status })
      .from(members)
      .where(eq(members.id, auth.uid))
      .limit(1);
    if (!cur) return notFound("회원 정보를 찾을 수 없습니다");
    if (cur.status === "suspended" || cur.status === "withdrawn") {
      return unauthorized("이용할 수 없는 계정입니다");
    }

    const updateData: any = { updatedAt: new Date() };
    if (d.name !== undefined) updateData.name = d.name;
    if (d.phone !== undefined) updateData.phone = d.phone;
    if (d.agreeEmail !== undefined) updateData.agreeEmail = d.agreeEmail;
    if (d.agreeSms !== undefined) updateData.agreeSms = d.agreeSms;
    if (d.agreeMail !== undefined) updateData.agreeMail = d.agreeMail;

    const [updated] = await db
      .update(members)
      .set(updateData)
      .where(eq(members.id, auth.uid))
      .returning({
        id: members.id,
        email: members.email,
        name: members.name,
        phone: members.phone,
        agreeEmail: members.agreeEmail,
        agreeSms: members.agreeSms,
        agreeMail: members.agreeMail,
      });

    return ok({ user: updated }, "회원 정보가 저장되었습니다");
  } catch (err) {
    console.error("[auth-me PATCH]", err);
    return serverError("회원 정보 저장 중 오류가 발생했습니다", err);
  }
}

export const config = { path: "/api/auth/me" };