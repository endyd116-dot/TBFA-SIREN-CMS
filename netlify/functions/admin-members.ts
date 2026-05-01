/**
 * GET    /api/admin/members              — 회원 목록 (페이징/필터)
 * GET    /api/admin/members?id=N         — 회원 상세
 * PATCH  /api/admin/members              — 상태 변경 (승인/정지/탈퇴)
 */
import { eq, desc, and, or, like, count, sql } from "drizzle-orm";
import { db, members, donations } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member: adminMember } = guard.ctx;

  try {
    /* ===== GET ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");

      /* 상세 */
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

        const { passwordHash, ...safe } = m;
        return ok({ member: safe, stats: { totalAmount: Number(stats?.totalAmount ?? 0), count: Number(stats?.count ?? 0) } });
      }

      /* 목록 */
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Number(url.searchParams.get("limit") || 20));
      const type = url.searchParams.get("type");
      const status = url.searchParams.get("status");
      const q = url.searchParams.get("q");

      const conditions: any[] = [];
      if (type && ["regular", "family", "volunteer", "admin"].includes(type)) {
        conditions.push(eq(members.type, type as any));
      }
      if (status && ["pending", "active", "suspended", "withdrawn"].includes(status)) {
        conditions.push(eq(members.status, status as any));
      }
      if (q) {
        conditions.push(or(like(members.name, `%${q}%`), like(members.email, `%${q}%`)));
      }
      const where = conditions.length === 0 ? undefined : (conditions.length === 1 ? conditions[0] : and(...conditions));

      const [{ total }] = await db.select({ total: count() }).from(members).where(where as any);

      const list = await db
        .select({
          id: members.id, email: members.email, name: members.name, phone: members.phone,
          type: members.type, status: members.status,
          lastLoginAt: members.lastLoginAt, createdAt: members.createdAt,
        })
        .from(members)
        .where(where as any)
        .orderBy(desc(members.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      return ok({
        list,
        pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
      });
    }

    /* ===== PATCH ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body?.id || !body?.status) return badRequest("id와 status가 필요합니다");

      const allowed = ["pending", "active", "suspended", "withdrawn"];
      if (!allowed.includes(body.status)) return badRequest("허용되지 않은 상태값");

      const memberId = Number(body.id);
      if (!Number.isFinite(memberId)) return badRequest("유효하지 않은 ID");

      /* 자기 자신은 정지 못함 */
      if (memberId === adminMember.id && body.status !== "active") {
        return badRequest("자기 자신의 상태는 변경할 수 없습니다");
      }

      const [updated] = await db
        .update(members)
        .set({ status: body.status, updatedAt: new Date() })
        .where(eq(members.id, memberId))
        .returning({ id: members.id, name: members.name, status: members.status });

      if (!updated) return notFound("회원을 찾을 수 없습니다");

      await logAdminAction(req, admin.uid, admin.name, "member_status_change", {
        target: `M-${memberId}`,
        detail: { newStatus: body.status, name: updated.name },
      });

      return ok({ member: updated }, "상태가 변경되었습니다");
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-members]", err);
    return serverError("회원 관리 중 오류", err);
  }
};

export const config = { path: "/api/admin/members" };