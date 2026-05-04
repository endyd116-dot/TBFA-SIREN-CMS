// netlify/functions/admin-operators.ts (헤더 영역)
/**
 * GET   /api/admin/operators           — 운영자 목록 (담당자 후보)
 * GET   /api/admin/operators?candidates=1 — 담당자 후보(승급 가능한 회원) 검색
 * POST  /api/admin/operators           — 회원을 운영자로 승급 (body: { memberId, role?, assignedCategories? })
 * PATCH /api/admin/operators           — 운영자 정보 수정 (body: { id, role?, notifyOnSupport?, operatorActive?, assignedCategories? })
 * DELETE /api/admin/operators?id=N     — 운영자 강등 (operator → regular)
 *
 * ★ M-15: assigned_categories (JSONB) 처리 추가
 * - super_admin은 어차피 알림 발송 시 카테고리 무시되므로 ['all'] 권장
 * - operator는 ['incident','harassment',...] 또는 ['all']
 * - 'all' 포함 시 다른 값 자동 제거 (정규화)
 */
import { eq, desc, and, ne, sql, or, like } from "drizzle-orm";
import { db, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, forbidden, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

/* ===== ★ M-15: 카테고리 화이트리스트 + 정규화 헬퍼 ===== */
const VALID_CATEGORIES = [
  "incident", "harassment", "legal", "board",
  "donation", "support", "all",
] as const;

/**
 * 입력값을 안전한 카테고리 배열로 정규화
 * - 화이트리스트 외 값 제거
 * - 중복 제거
 * - 'all' 포함 시 다른 값 모두 제거 → ['all']로 단일화
 * - null/undefined/비배열 → [] 반환
 */
function sanitizeCategories(input: any): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const c of input) {
    if (typeof c === "string" && (VALID_CATEGORIES as readonly string[]).includes(c)) {
      set.add(c);
    }
  }
  if (set.has("all")) return ["all"];
  return Array.from(set);
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    /* ===== GET ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const isCandidates = url.searchParams.get("candidates") === "1";
      const search = (url.searchParams.get("q") || "").trim();

      /* 담당자 후보 검색 (admin이 아닌 active 회원) */
      if (isCandidates) {
        const where: any[] = [
          eq(members.status, "active"),
          ne(members.type, "admin"),
        ];

        let queryWhere: any = and(...where);
        if (search.length >= 2) {
          queryWhere = and(
            ...where,
            or(
              like(members.name, `%${search}%`),
              like(members.email, `%${search}%`)
            )
          );
        }

        const candidates = await db
          .select({
            id: members.id,
            name: members.name,
            email: members.email,
            phone: members.phone,
            type: members.type,
            createdAt: members.createdAt,
          })
          .from(members)
          .where(queryWhere)
          .orderBy(desc(members.createdAt))
          .limit(50);

        return ok({ candidates });
      }

  // admin-operators.ts — GET 운영자 목록 select 부분
      /* 운영자 목록 (type=admin) */
      const operators = await db
        .select({
          id: members.id,
          name: members.name,
          email: members.email,
          phone: members.phone,
          type: members.type,
          status: members.status,
          role: members.role,
          notifyOnSupport: members.notifyOnSupport,
          operatorActive: members.operatorActive,
          assignedCategories: members.assignedCategories,  // ★ M-15
          lastLoginAt: members.lastLoginAt,
          createdAt: members.createdAt,
        })
        .from(members)
        .where(eq(members.type, "admin"))
        .orderBy(desc(members.createdAt));

      return ok({
        operators,
        stats: {
          total: operators.length,
          superAdmins: operators.filter((o: any) => o.role === "super_admin").length,
          regular: operators.filter((o: any) => o.role !== "super_admin").length,
          active: operators.filter((o: any) => o.operatorActive !== false).length,
        },
      });
    }

   // admin-operators.ts — POST (승급) 블록 전체 교체
    /* ===== POST (승급) ===== */
    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body?.memberId) return badRequest("memberId가 필요합니다");

      const memberId = Number(body.memberId);
      if (!Number.isFinite(memberId)) return badRequest("유효하지 않은 ID");

      const role = body.role === "super_admin" ? "super_admin" : "operator";
      const notifyOnSupport = body.notifyOnSupport !== false; // 기본 true

      /* ★ M-15: 카테고리 처리
         - 입력 없거나 잘못된 값: super_admin은 ['all'], operator는 [] (명시적 할당 필요)
         - super_admin은 알림 발송 시 카테고리 무시되지만, 일관성을 위해 ['all'] 기본값 부여 */
      let assignedCategories: string[];
      if (body.assignedCategories !== undefined) {
        assignedCategories = sanitizeCategories(body.assignedCategories);
      } else {
        assignedCategories = role === "super_admin" ? ["all"] : [];
      }

      /* 회원 존재 확인 */
      const [existing] = await db
        .select({ id: members.id, name: members.name, type: members.type })
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);

      if (!existing) return notFound("회원을 찾을 수 없습니다");
      if (existing.type === "admin") return badRequest("이미 운영자입니다");

      /* 승급 */
      const updateData: any = {
        type: "admin",
        role,
        notifyOnSupport,
        operatorActive: true,
        assignedCategories,  // ★ M-15
        updatedAt: new Date(),
      };

      const [updated] = await db
        .update(members)
        .set(updateData)
        .where(eq(members.id, memberId))
        .returning();

      await logAdminAction(req, admin.uid, admin.name, "operator_promote", {
        target: `M-${memberId}`,
        detail: { name: existing.name, newRole: role, notifyOnSupport, assignedCategories },
      });

      return ok({ operator: updated }, `${existing.name}님이 운영자로 승급되었습니다`);
    }

// admin-operators.ts — PATCH (수정) 블록 전체 교체
    /* ===== PATCH (운영자 정보 수정) ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body?.id) return badRequest("id가 필요합니다");

      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      const updateData: any = { updatedAt: new Date() };
      if (typeof body.role === "string" && ["super_admin", "operator"].includes(body.role)) {
        updateData.role = body.role;
      }
      if (typeof body.notifyOnSupport === "boolean") {
        updateData.notifyOnSupport = body.notifyOnSupport;
      }
      if (typeof body.operatorActive === "boolean") {
        updateData.operatorActive = body.operatorActive;
      }

      /* ★ M-15: assigned_categories 수정 */
      if (body.assignedCategories !== undefined) {
        updateData.assignedCategories = sanitizeCategories(body.assignedCategories);
      }

      /* 자기 자신을 비활성화하는 건 차단 */
      if (id === admin.uid && updateData.operatorActive === false) {
        return forbidden("자기 자신을 비활성화할 수 없습니다");
      }

      /* ★ M-15: 자기 자신의 super_admin role을 강등하는 것도 차단 (마지막 super_admin 보호) */
      if (id === admin.uid && updateData.role === "operator") {
        const superAdmins: any = await db
          .select({ c: sql<number>`count(*)::int` })
          .from(members)
          .where(and(eq(members.type, "admin"), eq(members.role, "super_admin")));
        const superCount = Number(superAdmins[0]?.c ?? 0);
        if (superCount <= 1) {
          return forbidden("최소 1명의 슈퍼 관리자가 필요합니다");
        }
      }

      const [updated] = await db
        .update(members)
        .set(updateData)
        .where(and(eq(members.id, id), eq(members.type, "admin")))
        .returning();

      if (!updated) return notFound("운영자를 찾을 수 없습니다");

      await logAdminAction(req, admin.uid, admin.name, "operator_update", {
        target: `M-${id}`,
        detail: updateData,
      });

      return ok({ operator: updated }, "운영자 정보가 수정되었습니다");
    }

    /* ===== DELETE (강등) ===== */
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const idStr = url.searchParams.get("id");
      if (!idStr) return badRequest("id가 필요합니다");

      const id = Number(idStr);
      if (!Number.isFinite(id)) return badRequest("유효하지 않은 ID");

      /* 자기 자신 강등 차단 */
      if (id === admin.uid) return forbidden("자기 자신은 강등할 수 없습니다");

      /* 슈퍼 관리자가 1명만 남으면 강등 차단 */
      const superAdmins: any = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(members)
        .where(and(eq(members.type, "admin"), eq(members.role, "super_admin")));
      const superCount = Number(superAdmins[0]?.c ?? 0);

      const [target] = await db
        .select({ id: members.id, name: members.name, role: members.role })
        .from(members)
        .where(eq(members.id, id))
        .limit(1);

      if (!target) return notFound("회원을 찾을 수 없습니다");
      if (target.role === "super_admin" && superCount <= 1) {
        return forbidden("최소 1명의 슈퍼 관리자가 필요합니다");
      }

      /* 강등: type → regular, role/operatorActive 초기화 */
      const demoteData: any = {
        type: "regular",
        role: null,
        notifyOnSupport: false,
        operatorActive: false,
        updatedAt: new Date(),
      };

      const [updated] = await db
        .update(members)
        .set(demoteData)
        .where(eq(members.id, id))
        .returning();

      await logAdminAction(req, admin.uid, admin.name, "operator_demote", {
        target: `M-${id}`,
        detail: { name: target.name, prevRole: target.role },
      });

      return ok({ member: updated }, `${target.name}님이 일반 회원으로 강등되었습니다`);
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-operators]", err);
    return serverError("운영자 관리 중 오류", err);
  }
};

export const config = { path: "/api/admin/operators" };