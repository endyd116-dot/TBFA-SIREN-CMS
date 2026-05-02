/**
 * GET   /api/admin/operators           — 운영자 목록 (담당자 후보)
 * GET   /api/admin/operators?candidates=1 — 담당자 후보(승급 가능한 회원) 검색
 * POST  /api/admin/operators           — 회원을 운영자로 승급 (body: { memberId, role? })
 * PATCH /api/admin/operators           — 운영자 정보 수정 (body: { id, ...fields })
 * DELETE /api/admin/operators?id=N     — 운영자 강등 (operator → regular)
 */
import { eq, desc, and, ne, sql, or, like } from "drizzle-orm";
import { db, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, forbidden, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

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

      /* 운영자 목록 (type=admin 또는 role 있음) */
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

    /* ===== POST (승급) ===== */
    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body?.memberId) return badRequest("memberId가 필요합니다");

      const memberId = Number(body.memberId);
      if (!Number.isFinite(memberId)) return badRequest("유효하지 않은 ID");

      const role = body.role === "super_admin" ? "super_admin" : "operator";
      const notifyOnSupport = body.notifyOnSupport !== false; // 기본 true

      /* 회원 존재 확인 */
      const [existing] = await db
        .select({ id: members.id, name: members.name, type: members.type })
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);

      if (!existing) return notFound("회원을 찾을 수 없습니다");
      if (existing.type === "admin") return badRequest("이미 운영자입니다");

      /* 승급 */
      /* 승급 */
      const updateData: any = {
        type: "admin",
        role,
        notifyOnSupport,
        operatorActive: true,
        updatedAt: new Date(),
      };

      const [updated] = await db
        .update(members)
        .set(updateData)
        .where(eq(members.id, memberId))
        .returning();
      await logAdminAction(req, admin.uid, admin.name, "operator_promote", {
        target: `M-${memberId}`,
        detail: { name: existing.name, newRole: role, notifyOnSupport },
      });

      return ok({ operator: updated }, `${existing.name}님이 운영자로 승급되었습니다`);
    }

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

      /* 자기 자신을 비활성화하는 건 차단 */
      if (id === admin.uid && updateData.operatorActive === false) {
        return forbidden("자기 자신을 비활성화할 수 없습니다");
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