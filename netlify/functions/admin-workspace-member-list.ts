// netlify/functions/admin-workspace-member-list.ts
/**
 * GET /api/admin-workspace-members
 *   운영자 목록 조회 (파일 공유/업무 배정용)
 *   - members.role IN ('admin', 'super_admin')
 *   - withdrawn_at IS NULL
 *   - 본인 제외
 *
 * 응답: { ok: true, data: [{id, name, email, role}, ...] }
 */
import { and, ne, isNull, inArray } from "drizzle-orm";
import { db } from "../../db";
import { members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, methodNotAllowed, corsPreflight, serverError,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.response;
    const meId = (auth.ctx.member as any)?.id || (auth.ctx.admin as any)?.id;

    const rows = await db
      .select({
        id: members.id,
        name: members.name,
        email: members.email,
        role: members.role,
      })
      .from(members)
      .where(
        and(
          inArray(members.role, ["admin", "super_admin"]),
          isNull(members.withdrawnAt),
          meId ? ne(members.id, meId) : undefined
        )
      )
      .orderBy(members.name);

    return ok({ data: rows });
  } catch (err: any) {
    console.error("[admin-workspace-member-list] error:", err);
    return serverError(err?.message || "운영자 목록 조회 실패");
  }
};

export const config = { path: "/api/admin-workspace-members" };
