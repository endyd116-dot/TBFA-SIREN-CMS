// netlify/functions/admin-members.ts
/**
 * GET    /api/admin/members              — 회원 목록 (페이징/필터/검색)
 * GET    /api/admin/members?id=N         — 회원 상세 (후원 통계 포함)
 * POST   /api/admin/members              — ★ K-7: 회원 직접 추가 (임시 비번 자동 생성)
 * PATCH  /api/admin/members              — 상태/메모/타입/잠금해제/이메일인증 변경
 *
 * ★ K-7 PATCH 분기:
 * - inlineStatusOnly:    status만 빠른 변경 (기존)
 * - inlineMemoOnly:      memo만 변경
 * - unlock=true:         lockedUntil=null + loginFailCount=0 으로 잠금 해제
 * - 일반 PATCH:          여러 필드 동시 변경 (status/type/memo/agreeXxx)
 * - emailVerified=true:  이메일 인증 강제 처리 (관리자 권한)
 *
 * ★ M-19-1 PATCH 분기 추가:
 * - setGrade=true:       등급 수동 변경 (gradeId/gradeLocked)
 *
 * ★ K-7 POST:
 * - name/email/phone/type/memo 입력
 * - 임시 비밀번호 자동 생성 (12자 랜덤, 응답에 1회만 노출)
 * - 유가족 회원은 status=pending, 그 외는 active
 * - emailVerified=false (사용자가 별도 인증 필요)
 */
import { eq, desc, and, or, like, count, sql } from "drizzle-orm";
import crypto from "crypto";
import { db, members, donations } from "../../db";
import { signupSources, memberGrades } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { hashPassword, checkPasswordStrength } from "../../lib/auth";
import { classifyForSignup } from "../../lib/member-classifier";
import { setMemberGradeManual } from "../../lib/grade-calculator";
import {
  ok, created, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";
import { z } from "zod";

/* ───────── POST 검증 스키마 ───────── */
const addMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("이메일 형식이 올바르지 않습니다"),
  name: z.string().trim().min(2, "이름은 2자 이상").max(50, "이름은 50자 이하"),
  phone: z.string().trim().regex(/^[0-9\-+\s()]{8,20}$/, "연락처 형식이 올바르지 않습니다"),
  type: z.enum(["regular", "family", "volunteer"]),
  memo: z.string().max(2000).optional(),
  /* ★ M-12: 관리자 추가 시 분류 옵션 (선택, 미지정 시 자동 분류) */
  memberCategory: z.enum(["sponsor", "regular", "family", "etc"]).optional(),
  memberSubtype: z.enum([
    "regular_donation", "hyosung_donation", "onetime_donation",
    "volunteer", "lawyer", "counselor",
  ]).optional(),
});

/* ───────── 임시 비밀번호 생성 (영문+숫자 조합 12자) ───────── */
function generateTempPassword(): string {
  /* 사람이 읽기 쉬운 문자만 사용 (0/O/1/l 제외) */
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;

  /* 12자 중 최소 1개씩 영문 대/소/숫자 보장 */
  let pw = "";
  pw += upper[crypto.randomInt(upper.length)];
  pw += lower[crypto.randomInt(lower.length)];
  pw += digits[crypto.randomInt(digits.length)];
  for (let i = 0; i < 9; i++) {
    pw += all[crypto.randomInt(all.length)];
  }

  /* 셔플 */
  const arr = pw.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member: adminMember } = guard.ctx;

  try {
    /* ===== GET ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");

      /* 상세 조회 */
      if (id) {
        const memberId = Number(id);
        const [m] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
        if (!m) return notFound("회원을 찾을 수 없습니다");

        /* 후원 통계 */
        const [stats] = await db
          .select({
            totalAmount: sql<number>`COALESCE(SUM(${donations.amount}), 0)`,
            count: count(),
          })
          .from(donations)
          .where(and(eq(donations.memberId, memberId), eq(donations.status, "completed")));

        const { passwordHash, ...safe } = m as any;
        return ok({
          member: safe,
          stats: {
            totalAmount: Number(stats?.totalAmount ?? 0),
            count: Number(stats?.count ?? 0),
          },
        });
      }

      /* 목록 조회 (★ M-12: 4분류 + 가입경로 / ★ M-19-1: 등급 추가) */
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Number(url.searchParams.get("limit") || 20));
      const type = url.searchParams.get("type");
      const status = url.searchParams.get("status");
      const category = url.searchParams.get("category");
      const subtype = url.searchParams.get("subtype");
      const sourceId = url.searchParams.get("source");
      const gradeIdParam = url.searchParams.get("grade");
      const q = (url.searchParams.get("q") || "").trim();

      const conditions: any[] = [];
      if (type && ["regular", "family", "volunteer", "admin"].includes(type)) {
        conditions.push(eq(members.type, type as any));
      }
      if (status && ["pending", "active", "suspended", "withdrawn"].includes(status)) {
        conditions.push(eq(members.status, status as any));
      }
      if (category && ["sponsor", "regular", "family", "etc"].includes(category)) {
        conditions.push(eq((members as any).memberCategory, category));
      }
      if (subtype) {
        const validSub = ["regular_donation", "hyosung_donation", "onetime_donation",
          "volunteer", "lawyer", "counselor"];
        if (validSub.includes(subtype)) {
          conditions.push(eq((members as any).memberSubtype, subtype));
        }
      }
      if (sourceId && /^\d+$/.test(sourceId)) {
        conditions.push(eq((members as any).signupSourceId, Number(sourceId)));
      }
      /* ★ M-19-1: 등급 필터 */
      if (gradeIdParam && /^\d+$/.test(gradeIdParam)) {
        conditions.push(eq((members as any).gradeId, Number(gradeIdParam)));
      }
      if (q && q.length >= 2) {
        const pattern = `%${q}%`;
        conditions.push(
          or(
            like(members.name, pattern),
            like(members.email, pattern),
            like(members.phone, pattern),
          ),
        );
      }
      const where: any =
        conditions.length === 0
          ? undefined
          : conditions.length === 1
            ? conditions[0]
            : and(...conditions);

      const [{ total }] = await db.select({ total: count() }).from(members).where(where);

      /* ★ M-12 + M-19-1: signup_sources + member_grades join */
      const list = await db
        .select({
          id: members.id,
          email: members.email,
          name: members.name,
          phone: members.phone,
          type: members.type,
          status: members.status,
          memberCategory: (members as any).memberCategory,
          memberSubtype: (members as any).memberSubtype,
          signupSourceId: (members as any).signupSourceId,
          sourceLabel: signupSources.label,
          sourceCode: signupSources.code,
          /* ★ M-19-1: 등급 컬럼들 */
          gradeId: (members as any).gradeId,
          gradeCode: memberGrades.code,
          gradeNameKo: memberGrades.nameKo,
          gradeIcon: memberGrades.icon,
          gradeColorHex: memberGrades.colorHex,
          totalDonationAmount: (members as any).totalDonationAmount,
          regularMonthsCount: (members as any).regularMonthsCount,
          gradeLocked: (members as any).gradeLocked,
          /* 기존 */
          emailVerified: members.emailVerified,
          lockedUntil: members.lockedUntil,
          memo: members.memo,
          lastLoginAt: members.lastLoginAt,
          createdAt: members.createdAt,
        })
        .from(members)
        .leftJoin(signupSources, eq((members as any).signupSourceId, signupSources.id))
        .leftJoin(memberGrades, eq((members as any).gradeId, memberGrades.id))
        .where(where as any)
        .orderBy(desc(members.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      /* ★ M-12: 카테고리별 카운트 (대시보드용) */
      const catStats: any = await db.execute(sql`
        SELECT
          COALESCE(member_category, 'unknown') AS category,
          COUNT(*)::int AS count
        FROM members
        WHERE status != 'withdrawn'
        GROUP BY member_category
      `);
      const categoryCounts: Record<string, number> = {};
      const catRows: any[] = Array.isArray(catStats) ? catStats : (catStats?.rows || []);
      for (const r of catRows) categoryCounts[r.category] = Number(r.count);

      return ok({
        list,
        pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
        categoryCounts,
      });
    }

    /* ===== POST (★ K-7: 회원 직접 추가) ===== */
    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const v: any = (() => {
        const r = addMemberSchema.safeParse(body);
        if (r.success) return { ok: true, data: r.data };
        return {
          ok: false,
          errors: r.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        };
      })();
      if (!v.ok) return badRequest("입력값을 확인해 주세요", v.errors);

      const data = v.data;

      /* 이메일 중복 확인 */
      const existing = await db
        .select({ id: members.id })
        .from(members)
        .where(eq(members.email, data.email))
        .limit(1);

      if (existing.length > 0) {
        return badRequest("이미 가입된 이메일입니다");
      }

      /* 임시 비밀번호 생성 + 해싱 */
      const tempPassword = generateTempPassword();
      const passwordHash = await hashPassword(tempPassword);

      /* 유가족은 pending, 그 외는 active */
      const status = data.type === "family" ? "pending" : "active";

      /* ★ M-12: 자동 분류 + 가입경로='admin' 자동 설정 */
      const classify = await classifyForSignup({
        type: data.type,
        signupSource: "admin",
      });

      const insertPayload: any = {
        email: data.email,
        passwordHash,
        name: data.name,
        phone: data.phone,
        type: data.type,
        status,
        emailVerified: false,
        memo: data.memo || null,
        agreeEmail: true,
        agreeSms: true,
        agreeMail: false,
        memberCategory: data.memberCategory || classify.memberCategory,
        memberSubtype: data.memberSubtype || classify.memberSubtype,
        signupSourceId: classify.signupSourceId,
      };

      const [inserted] = await db
        .insert(members)
        .values(insertPayload)
        .returning({
          id: members.id,
          email: members.email,
          name: members.name,
          type: members.type,
          status: members.status,
        });

      await logAdminAction(req, admin.uid, admin.name, "member_create", {
        target: `M-${inserted.id}`,
        detail: {
          email: inserted.email,
          name: inserted.name,
          type: inserted.type,
          status: inserted.status,
          tempPasswordGenerated: true,
        },
      });

      return created(
        {
          member: inserted,
          tempPassword,
        },
        `회원이 추가되었습니다. 임시 비밀번호를 회원에게 전달하고, 첫 로그인 후 변경하도록 안내해 주세요.`,
      );
    }

    /* ===== PATCH ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body?.id) return badRequest("id가 필요합니다");

      const memberId = Number(body.id);
      if (!Number.isFinite(memberId)) return badRequest("유효하지 않은 ID");

      /* 자기 자신 제한 */
      if (memberId === adminMember.id) {
        if (body.status && body.status !== "active") {
          return badRequest("자기 자신의 상태는 변경할 수 없습니다");
        }
        if (body.type && body.type !== adminMember.type) {
          return badRequest("자기 자신의 타입은 변경할 수 없습니다");
        }
      }

      /* 기존 회원 조회 */
      const [existingRow] = await db
        .select()
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);
      if (!existingRow) return notFound("회원을 찾을 수 없습니다");
      const existing: any = existingRow;

      /* ───── 분기 1: inlineStatusOnly (기존 호환) ───── */
      if (body.inlineStatusOnly === true) {
        const allowed = ["pending", "active", "suspended", "withdrawn"];
        if (!allowed.includes(body.status)) return badRequest("허용되지 않은 상태값");

        const [updated] = await db
          .update(members)
          .set({ status: body.status, updatedAt: new Date() } as any)
          .where(eq(members.id, memberId))
          .returning({
            id: members.id,
            name: members.name,
            status: members.status,
          });

        await logAdminAction(req, admin.uid, admin.name, "member_status_change", {
          target: `M-${memberId}`,
          detail: { newStatus: body.status, name: updated.name, mode: "inline" },
        });

        return ok({ member: updated }, "상태가 변경되었습니다");
      }

      /* ───── 분기 2: ★ K-7 inlineMemoOnly (메모만 빠른 저장) ───── */
      if (body.inlineMemoOnly === true) {
        const memo = typeof body.memo === "string" ? body.memo.slice(0, 2000) : "";

        const [updated] = await db
          .update(members)
          .set({ memo, updatedAt: new Date() } as any)
          .where(eq(members.id, memberId))
          .returning({
            id: members.id,
            name: members.name,
            memo: members.memo,
          });

        await logAdminAction(req, admin.uid, admin.name, "member_memo_update", {
          target: `M-${memberId}`,
          detail: { name: updated.name, memoLength: memo.length },
        });

        return ok({ member: updated }, "메모가 저장되었습니다");
      }

      /* ───── 분기 3: ★ K-7 unlock (잠금 해제) ───── */
      if (body.unlock === true) {
        if (!existing.lockedUntil && (existing.loginFailCount ?? 0) === 0) {
          return badRequest("잠긴 계정이 아닙니다");
        }

        const [updated] = await db
          .update(members)
          .set({
            lockedUntil: null,
            loginFailCount: 0,
            updatedAt: new Date(),
          } as any)
          .where(eq(members.id, memberId))
          .returning({
            id: members.id,
            name: members.name,
            email: members.email,
          });

        await logAdminAction(req, admin.uid, admin.name, "member_unlock", {
          target: `M-${memberId}`,
          detail: { name: updated.name, email: updated.email },
        });

        return ok({ member: updated }, "계정 잠금이 해제되었습니다");
      }

      /* ───── 분기 4: ★ K-7 verifyEmail (관리자 강제 이메일 인증) ───── */
      if (body.verifyEmail === true) {
        if (existing.emailVerified) {
          return badRequest("이미 이메일 인증이 완료된 계정입니다");
        }

        const [updated] = await db
          .update(members)
          .set({ emailVerified: true, updatedAt: new Date() } as any)
          .where(eq(members.id, memberId))
          .returning({
            id: members.id,
            name: members.name,
            email: members.email,
            emailVerified: members.emailVerified,
          });

        await logAdminAction(req, admin.uid, admin.name, "member_verify_email_admin", {
          target: `M-${memberId}`,
          detail: {
            name: updated.name,
            email: updated.email,
            method: "admin_force",
          },
        });

        return ok({ member: updated }, "이메일 인증이 완료 처리되었습니다");
      }

      /* ───── 분기 4.5: ★ M-19-1 setGrade (등급 수동 변경) ───── */
      if (body.setGrade === true) {
        const gradeId = body.gradeId === null ? null : Number(body.gradeId);
        const lock = body.gradeLocked === true;

        if (gradeId !== null && !Number.isFinite(gradeId)) {
          return badRequest("유효하지 않은 등급 ID");
        }

        const okFlag = await setMemberGradeManual(memberId, gradeId, lock);
        if (!okFlag) {
          return serverError("등급 변경 실패");
        }

        await logAdminAction(req, admin.uid, admin.name, "grade_set_manual", {
          target: `M-${memberId}`,
          detail: {
            name: existing.name,
            newGradeId: gradeId,
            locked: lock,
          },
        });

        return ok(
          { id: memberId, gradeId, gradeLocked: lock },
          lock
            ? "등급이 수동 지정되었습니다 (자동 갱신 잠금)"
            : "등급이 변경되었습니다",
        );
      }

      /* ───── 분기 5: 일반 PATCH (여러 필드 동시 변경) ───── */
      const updatePayload: any = { updatedAt: new Date() };
      const changedFields: string[] = [];

      /* status */
      if (body.status !== undefined) {
        const allowed = ["pending", "active", "suspended", "withdrawn"];
        if (!allowed.includes(body.status)) {
          return badRequest("허용되지 않은 상태값");
        }
        if (body.status === "withdrawn") {
          return badRequest(
            "탈퇴 상태로 직접 변경할 수 없습니다. 회원이 직접 탈퇴하거나 별도 절차를 이용해 주세요.",
          );
        }
        updatePayload.status = body.status;
        changedFields.push("status");
      }

      /* type */
      if (body.type !== undefined) {
        const allowedTypes = ["regular", "family", "volunteer", "admin"];
        if (!allowedTypes.includes(body.type)) {
          return badRequest("허용되지 않은 회원 유형");
        }
        if (body.type === "admin" && existing.type !== "admin") {
          return badRequest(
            "type=admin으로의 승급은 운영자 관리에서 별도 처리해 주세요",
          );
        }
        updatePayload.type = body.type;
        changedFields.push("type");
      }

      /* memo */
      if (body.memo !== undefined) {
        updatePayload.memo = String(body.memo).slice(0, 2000);
        changedFields.push("memo");
      }

      /* phone */
      if (body.phone !== undefined && typeof body.phone === "string") {
        const phone = body.phone.trim();
        if (phone && !/^[0-9\-+\s()]{8,20}$/.test(phone)) {
          return badRequest("연락처 형식이 올바르지 않습니다");
        }
        updatePayload.phone = phone || null;
        changedFields.push("phone");
      }

      /* 알림 동의 (선택) */
      if (typeof body.agreeEmail === "boolean") {
        updatePayload.agreeEmail = body.agreeEmail;
        changedFields.push("agreeEmail");
      }
      if (typeof body.agreeSms === "boolean") {
        updatePayload.agreeSms = body.agreeSms;
        changedFields.push("agreeSms");
      }
      if (typeof body.agreeMail === "boolean") {
        updatePayload.agreeMail = body.agreeMail;
        changedFields.push("agreeMail");
      }

      if (changedFields.length === 0) {
        return badRequest("변경할 항목이 없습니다");
      }

      const [updated] = await db
        .update(members)
        .set(updatePayload)
        .where(eq(members.id, memberId))
        .returning({
          id: members.id,
          name: members.name,
          email: members.email,
          phone: members.phone,
          type: members.type,
          status: members.status,
          memo: members.memo,
          emailVerified: members.emailVerified,
          agreeEmail: members.agreeEmail,
          agreeSms: members.agreeSms,
          agreeMail: members.agreeMail,
        });

      await logAdminAction(req, admin.uid, admin.name, "member_update", {
        target: `M-${memberId}`,
        detail: { name: updated.name, changedFields },
      });

      return ok({ member: updated }, "회원 정보가 변경되었습니다");
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-members]", err);
    return serverError("회원 관리 중 오류", err);
  }
};

export const config = { path: "/api/admin/members" };