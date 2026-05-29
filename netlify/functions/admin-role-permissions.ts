import { db } from "../../db";
import { rolePermissions } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ok, badRequest, notFound, forbidden, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";
import { invalidatePermissionCache } from "../../lib/role-permission-check";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-role-permissions" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));

  try {
    if (req.method === "GET") {
      const rows = await db.select().from(rolePermissions).orderBy(rolePermissions.id);
      return ok({ permissions: rows });
    }

    /* PATCH — super_admin 전용 */
    if (req.method === "PATCH") {
      // R45 CLUSTER-1: 권한정책 편집은 super_admin 전용 — DB 역할로 판정
      // (JWT role은 elevate가 type 기반으로 부풀릴 수 있어 신뢰 금지)
      if (auth.ctx.member.role !== "super_admin") return forbidden("super_admin 권한이 필요합니다");
      if (!id) return badRequest("id 파라미터가 필요합니다");

      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const updateData: Record<string, unknown> = {};
      if (typeof body.adminAllowed    === "boolean") updateData.adminAllowed    = body.adminAllowed;
      if (typeof body.operatorAllowed === "boolean") updateData.operatorAllowed = body.operatorAllowed;
      updateData.updatedAt = new Date();

      if (Object.keys(updateData).length <= 1) return badRequest("수정할 항목이 없습니다");

      const [updated] = await db
        .update(rolePermissions)
        .set(updateData as any)
        .where(eq(rolePermissions.id, id))
        .returning();

      if (!updated) return notFound("해당 권한 규칙을 찾을 수 없습니다");
      invalidatePermissionCache();
      // R45 SU-023: 권한 정책 변경(최고민감)은 감사 로그 필수 — critical 등급 자동 부여
      try {
        await logAdminAction(req, auth.ctx.member.id, auth.ctx.member.name, "admin_permission_change", { target: `perm-${id}`, detail: updateData });
      } catch (e) { console.warn("[admin-role-permissions] 감사 로그 실패:", e); }
      return ok({ permission: updated });
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-role-permissions]", err);
    return serverError("권한 정책 처리 중 오류가 발생했습니다", err);
  }
};
