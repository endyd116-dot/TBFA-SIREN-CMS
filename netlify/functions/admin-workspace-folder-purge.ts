// netlify/functions/admin-workspace-folder-purge.ts
/**
 * DELETE /api/admin-workspace-folder-purge?folderId=N
 *   폴더 영구 삭제 (재귀: 자식 폴더 + 모든 파일 + R2 객체)
 *   - 권한: super_admin or 소유자
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { workspaceFolders, workspaceFiles } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { deleteFromR2 } from "../../lib/r2-delete";
import { logAudit } from "../../lib/audit";
import {
  ok, badRequest, notFound, forbidden,
  methodNotAllowed, corsPreflight, serverError,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "DELETE" && req.method !== "POST") return methodNotAllowed();

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;
    const meId = (auth.ctx.member as any)?.id || (auth.ctx.admin as any)?.id;
    const meRole = (auth.ctx.member as any)?.role || (auth.ctx.admin as any)?.role;

    const url = new URL(req.url);
    const folderId = parseInt(url.searchParams.get("folderId") || "0", 10);
    if (!folderId) return badRequest("folderId 필수");

    const rows = await db
      .select()
      .from(workspaceFolders)
      .where(eq(workspaceFolders.id, folderId))
      .limit(1);
    const folder = rows[0];
    if (!folder) return notFound("폴더를 찾을 수 없습니다");

    const isSuper = meRole === "super_admin";
    const isOwner = (folder as any).ownerId === meId;
    if (!isSuper && !isOwner) return forbidden("영구 삭제 권한이 없습니다");

    /* 재귀: 자식 폴더 ID 수집 */
    const allFolderIds: number[] = [folderId];
    let queue: number[] = [folderId];
    while (queue.length > 0) {
      const children: any = await db
        .select({ id: workspaceFolders.id })
        .from(workspaceFolders)
        .where(inArray(workspaceFolders.parentId, queue));
      const newIds = (children || []).map((c: any) => c.id);
      if (!newIds.length) break;
      allFolderIds.push(...newIds);
      queue = newIds;
    }

    /* 모든 자식 파일 조회 */
    const allFiles: any = await db
      .select()
      .from(workspaceFiles)
      .where(inArray(workspaceFiles.folderId, allFolderIds));

    /* R2 순차 삭제 */
    let r2Deleted = 0;
    let r2Failed = 0;
    for (const f of (allFiles as any[])) {
      if (f.r2Key) {
        const r = await deleteFromR2(f.r2Key);
        if (r.success) r2Deleted++;
        else r2Failed++;
      }
    }

    /* DB hard delete: 파일 → 폴더 순서 */
    if ((allFiles as any[]).length > 0) {
      await db.delete(workspaceFiles).where(inArray(workspaceFiles.folderId, allFolderIds));
    }
    await db.delete(workspaceFolders).where(inArray(workspaceFolders.id, allFolderIds));

    try {
      await logAudit({
        memberId: meId,
        action: "WORKSPACE_FOLDER_PURGE",
        targetType: "workspace_folder",
        targetId: folderId,
        detail: {
          folderName: (folder as any).name,
          foldersDeleted: allFolderIds.length,
          filesDeleted: (allFiles as any[]).length,
          r2Deleted,
          r2Failed,
        },
      } as any);
    } catch (e) {
      console.warn("[folder-purge] audit failed:", e);
    }

    return ok({
      foldersDeleted: allFolderIds.length,
      filesDeleted: (allFiles as any[]).length,
      r2Deleted,
      r2Failed,
    }, `${allFolderIds.length}개 폴더 + ${(allFiles as any[]).length}개 파일 영구 삭제됨`);
  } catch (err: any) {
    console.error("[folder-purge] error:", err);
    return serverError(err?.message || "폴더 영구 삭제 실패");
  }
};

export const config = { path: "/api/admin-workspace-folder-purge" };
