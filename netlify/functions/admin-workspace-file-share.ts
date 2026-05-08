/**
 * Phase 3-extra: 워크스페이스 파일/폴더 공유 관리
 *
 * GET    ?targetType=file&targetId=N : 공유 목록
 * POST   {targetType, targetId, sharedWith?, permission, expiresAt?} : 공유 생성
 * PATCH  ?id=N {permission?, expiresAt?} : 권한 변경
 * DELETE ?id=N : 공유 해제
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { workspaceFileShares, workspaceFiles, workspaceFolders, members } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, serverError,
  methodNotAllowed, parseJson
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

async function getTarget(targetType: string, targetId: number): Promise<any | null> {
  if (targetType === "file") {
    const rows: any = await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, targetId)).limit(1);
    return rows[0] || null;
  }
  if (targetType === "folder") {
    const rows: any = await db.select().from(workspaceFolders).where(eq(workspaceFolders.id, targetId)).limit(1);
    return rows[0] || null;
  }
  return null;
}

export default async (req: Request, _ctx: Context) => {
  const method = req.method;

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.response;
    const meId = (auth.ctx.member as any).id as number;
    const isSuperAdmin = ((auth.ctx.member as any).role || "") === "super_admin";

    const url = new URL(req.url);

    /* =========================
       GET — 공유 목록
       ========================= */
    if (method === "GET") {
      const targetType = url.searchParams.get("targetType");
      const targetId = Number(url.searchParams.get("targetId") || 0);
      if (!targetType || !targetId) return badRequest("targetType, targetId 필수");
      if (!["file", "folder"].includes(targetType)) return badRequest("targetType은 file 또는 folder");

      const target = await getTarget(targetType, targetId);
      if (!target) return notFound("대상을 찾을 수 없습니다");
      if (!isSuperAdmin && target.ownerId !== meId) return forbidden("조회 권한 없음");

      const shares: any = await db
        .select({
          id: workspaceFileShares.id,
          targetType: workspaceFileShares.targetType,
          targetId: workspaceFileShares.targetId,
          sharedBy: workspaceFileShares.sharedBy,
          sharedWith: workspaceFileShares.sharedWith,
          permission: workspaceFileShares.permission,
          expiresAt: workspaceFileShares.expiresAt,
          createdAt: workspaceFileShares.createdAt,
          sharedWithName: members.name,
          sharedWithEmail: members.email
        })
        .from(workspaceFileShares)
        .leftJoin(members, eq(workspaceFileShares.sharedWith, members.id))
        .where(
          and(
            eq(workspaceFileShares.targetType, targetType),
            eq(workspaceFileShares.targetId, targetId)
          )
        );

      return ok({ items: shares, total: shares.length });
    }

    /* =========================
       POST — 공유 생성
       ========================= */
    if (method === "POST") {
      const body = await parseJson<any>(req);
      if (!body) return badRequest("body 필수");

      const targetType = String(body.targetType || "");
      const targetId = Number(body.targetId || 0);
      if (!["file", "folder"].includes(targetType)) return badRequest("targetType은 file 또는 folder");
      if (!targetId) return badRequest("targetId 필수");

      const target = await getTarget(targetType, targetId);
      if (!target) return notFound("대상을 찾을 수 없습니다");
      if (!isSuperAdmin && target.ownerId !== meId) return forbidden("공유 권한 없음");

      const sharedWith = body.sharedWith ? Number(body.sharedWith) : null;
      const permission = ["view", "edit"].includes(body.permission) ? body.permission : "view";
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

      // sharedWith 회원 존재 확인
      if (sharedWith) {
        const memRows: any = await db.select({ id: members.id }).from(members).where(eq(members.id, sharedWith)).limit(1);
        if (memRows.length === 0) return badRequest("공유 대상 회원을 찾을 수 없습니다");
      }

      // 중복 방지
      const dupConds: any[] = [
        eq(workspaceFileShares.targetType, targetType),
        eq(workspaceFileShares.targetId, targetId)
      ];
      if (sharedWith) dupConds.push(eq(workspaceFileShares.sharedWith, sharedWith));
      const dupRows: any = await db
        .select()
        .from(workspaceFileShares)
        .where(and(...dupConds))
        .limit(1);
      if (dupRows.length > 0) {
        // 기존 업데이트
        const updated: any = await db
          .update(workspaceFileShares)
          .set({ permission, expiresAt })
          .where(eq(workspaceFileShares.id, dupRows[0].id))
          .returning();
        return ok(updated[0], "공유 정보가 업데이트되었습니다");
      }

      const inserted: any = await db
        .insert(workspaceFileShares)
        .values({
          targetType,
          targetId,
          sharedBy: meId,
          sharedWith,
          permission,
          expiresAt
        })
        .returning();

      await logAudit({
        actorMemberId: meId,
        action: "workspace.share.create",
        targetType: `workspace_${targetType}`,
        targetId,
        meta: { sharedWith, permission, expiresAt: expiresAt?.toISOString() }
      });

      return ok(inserted[0], "공유가 생성되었습니다");
    }

    /* =========================
       PATCH — 권한 변경
       ========================= */
    if (method === "PATCH") {
      const id = Number(url.searchParams.get("id") || 0);
      if (!id) return badRequest("id 필수");

      const rows: any = await db.select().from(workspaceFileShares).where(eq(workspaceFileShares.id, id)).limit(1);
      const share = rows[0];
      if (!share) return notFound("공유를 찾을 수 없습니다");

      const target = await getTarget(share.targetType, share.targetId);
      if (!target) return notFound("대상이 삭제되었습니다");
      if (!isSuperAdmin && target.ownerId !== meId && share.sharedBy !== meId) {
        return forbidden("수정 권한 없음");
      }

      const body = await parseJson<any>(req);
      if (!body) return badRequest("body 필수");

      const updateData: any = {};
      if (body.permission && ["view", "edit"].includes(body.permission)) {
        updateData.permission = body.permission;
      }
      if (body.expiresAt !== undefined) {
        updateData.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      }
      if (Object.keys(updateData).length === 0) return badRequest("변경할 항목 없음");

      const updated: any = await db
        .update(workspaceFileShares)
        .set(updateData)
        .where(eq(workspaceFileShares.id, id))
        .returning();

      await logAudit({
        actorMemberId: meId,
        action: "workspace.share.update",
        targetType: `workspace_${share.targetType}`,
        targetId: share.targetId,
        meta: { shareId: id, changes: Object.keys(updateData) }
      });

      return ok(updated[0], "공유가 수정되었습니다");
    }

    /* =========================
       DELETE — 공유 해제
       ========================= */
    if (method === "DELETE") {
      const id = Number(url.searchParams.get("id") || 0);
      if (!id) return badRequest("id 필수");

      const rows: any = await db.select().from(workspaceFileShares).where(eq(workspaceFileShares.id, id)).limit(1);
      const share = rows[0];
      if (!share) return notFound("공유를 찾을 수 없습니다");

      const target = await getTarget(share.targetType, share.targetId);
      if (!isSuperAdmin && share.sharedBy !== meId && target?.ownerId !== meId) {
        return forbidden("해제 권한 없음");
      }

      await db.delete(workspaceFileShares).where(eq(workspaceFileShares.id, id));

      await logAudit({
        actorMemberId: meId,
        action: "workspace.share.delete",
        targetType: `workspace_${share.targetType}`,
        targetId: share.targetId,
        meta: { shareId: id }
      });

      return ok({ id }, "공유가 해제되었습니다");
    }

    return methodNotAllowed("GET / POST / PATCH / DELETE 만 허용");
  } catch (err: any) {
    console.error("[admin-workspace-file-share]", err);
    return serverError("공유 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin-workspace-file-share" };
