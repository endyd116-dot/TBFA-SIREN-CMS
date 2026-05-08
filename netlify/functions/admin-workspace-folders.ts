/**
 * Phase 3-extra: 워크스페이스 폴더 CRUD
 *
 * GET    ?list=1                       : 내 + 공유받은 폴더 트리
 * GET    ?id=N                         : 폴더 단건
 * GET    ?trash=1                      : 휴지통 (deletedAt IS NOT NULL)
 * POST   {parentId, name, description} : 폴더 생성
 * PATCH  ?id=N {name?, parentId?, description?} : 수정/이동
 * PATCH  ?id=N&action=restore          : 휴지통 복원
 * PATCH  ?id=N&action=toggle-public    : isShared 토글
 * DELETE ?id=N                         : soft delete (재귀)
 * DELETE ?id=N&hard=1                  : 영구 삭제 (super_admin or owner only)
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { workspaceFolders, workspaceFiles, workspaceFileShares, members } from "../../db/schema";
import { eq, and, or, isNull, isNotNull, sql, inArray } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, methodNotAllowed,
  serverError, parseJson
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

const MAX_DEPTH = 10;
const MAX_NAME_LEN = 200;

/* ───── helpers ───── */

function sanitizeName(name: string): string {
  return String(name || "").trim().replace(/[\\/:*?"<>|]/g, "_").slice(0, MAX_NAME_LEN);
}

async function getFolder(id: number): Promise<any | null> {
  const rows: any = await db.select().from(workspaceFolders).where(eq(workspaceFolders.id, id)).limit(1);
  return rows[0] || null;
}

async function checkFolderAccess(folder: any, meId: number, isSuperAdmin: boolean, requireEdit = false): Promise<boolean> {
  if (isSuperAdmin) return true;
  if (folder.ownerId === meId) return true;
  if (folder.isShared && !requireEdit) return true;

  // 명시적 공유 확인
  const shares: any = await db
    .select()
    .from(workspaceFileShares)
    .where(
      and(
        eq(workspaceFileShares.targetType, "folder"),
        eq(workspaceFileShares.targetId, folder.id),
        or(eq(workspaceFileShares.sharedWith, meId), isNull(workspaceFileShares.sharedWith))
      )
    )
    .limit(5);

  for (const s of shares) {
    if (requireEdit) {
      if (s.permission === "edit") return true;
    } else {
      return true;
    }
  }
  return false;
}

async function buildPath(parentId: number | null, name: string): Promise<{ path: string; depth: number }> {
  if (!parentId) return { path: `/${name}`, depth: 0 };
  const parent = await getFolder(parentId);
  if (!parent) throw new Error("부모 폴더를 찾을 수 없습니다");
  if (parent.deletedAt) throw new Error("삭제된 부모 폴더에는 생성할 수 없습니다");
  const depth = (parent.depth || 0) + 1;
  if (depth > MAX_DEPTH) throw new Error(`최대 폴더 깊이(${MAX_DEPTH})를 초과합니다`);
  return { path: `${parent.path || ""}/${name}`, depth };
}

async function getDescendantFolderIds(rootId: number): Promise<number[]> {
  // path LIKE 기반 재귀 ID 수집
  const root = await getFolder(rootId);
  if (!root) return [];
  const rows: any = await db
    .select({ id: workspaceFolders.id })
    .from(workspaceFolders)
    .where(
      or(
        eq(workspaceFolders.id, rootId),
        sql`${workspaceFolders.path} LIKE ${(root.path || "") + "/%"}`
      )
    );
  return rows.map((r: any) => r.id);
}

/* ───── handler ───── */

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const method = req.method;

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.res;
    const meId = (auth.ctx.member as any).id as number;
    const isSuperAdmin = ((auth.ctx.member as any).role || "") === "super_admin";

    /* =========================
       GET — 조회
       ========================= */
    if (method === "GET") {
      const id = url.searchParams.get("id");
      const listFlag = url.searchParams.get("list");
      const trashFlag = url.searchParams.get("trash");

      // 휴지통
      if (trashFlag === "1") {
        const where = isSuperAdmin
          ? isNotNull(workspaceFolders.deletedAt)
          : and(isNotNull(workspaceFolders.deletedAt), eq(workspaceFolders.ownerId, meId));
        const items: any = await db
          .select()
          .from(workspaceFolders)
          .where(where)
          .orderBy(sql`${workspaceFolders.deletedAt} DESC`)
          .limit(200);
        return ok({ items, total: items.length });
      }

      // 단건
      if (id) {
        const folder = await getFolder(Number(id));
        if (!folder) return notFound("폴더를 찾을 수 없습니다");
        if (folder.deletedAt) return notFound("삭제된 폴더입니다");
        const can = await checkFolderAccess(folder, meId, isSuperAdmin);
        if (!can) return forbidden("접근 권한이 없습니다");
        return ok(folder);
      }

      // 트리
      if (listFlag === "1") {
        // 내 폴더 + 공개 + 명시적 공유 받은 폴더 + super는 전체
        let items: any;
        if (isSuperAdmin) {
          items = await db
            .select()
            .from(workspaceFolders)
            .where(isNull(workspaceFolders.deletedAt))
            .orderBy(workspaceFolders.path);
        } else {
          // 1) 내 폴더
          // 2) is_shared=true
          // 3) workspace_file_shares 매칭
          const sharedFolderIdsRows: any = await db
            .select({ targetId: workspaceFileShares.targetId })
            .from(workspaceFileShares)
            .where(
              and(
                eq(workspaceFileShares.targetType, "folder"),
                or(
                  eq(workspaceFileShares.sharedWith, meId),
                  isNull(workspaceFileShares.sharedWith)
                )
              )
            );
          const sharedIds = sharedFolderIdsRows.map((r: any) => r.targetId);

          const conds: any[] = [
            eq(workspaceFolders.ownerId, meId),
            eq(workspaceFolders.isShared, true)
          ];
          if (sharedIds.length > 0) {
            conds.push(inArray(workspaceFolders.id, sharedIds));
          }

          items = await db
            .select()
            .from(workspaceFolders)
            .where(and(isNull(workspaceFolders.deletedAt), or(...conds)))
            .orderBy(workspaceFolders.path);
        }

        return ok({ items, total: items.length });
      }

      return badRequest("list=1 / id=N / trash=1 중 하나 필수");
    }

    /* =========================
       POST — 생성
       ========================= */
    if (method === "POST") {
      const body = await parseJson<any>(req);
      if (!body) return badRequest("body 필수");

      const name = sanitizeName(body.name);
      if (!name) return badRequest("name 필수");

      const parentId = body.parentId ? Number(body.parentId) : null;

      // 부모 권한 체크
      if (parentId) {
        const parent = await getFolder(parentId);
        if (!parent) return notFound("부모 폴더를 찾을 수 없습니다");
        if (parent.deletedAt) return badRequest("삭제된 부모 폴더입니다");
        const canEdit = await checkFolderAccess(parent, meId, isSuperAdmin, true);
        if (!canEdit) return forbidden("부모 폴더에 쓰기 권한이 없습니다");
      }

      // path/depth 계산
      let pathInfo;
      try {
        pathInfo = await buildPath(parentId, name);
      } catch (e: any) {
        return badRequest(e.message);
      }

      // 동명 검증 (active 폴더 중)
      const dupRows: any = await db
        .select({ id: workspaceFolders.id })
        .from(workspaceFolders)
        .where(
          and(
            isNull(workspaceFolders.deletedAt),
            eq(workspaceFolders.name, name),
            parentId ? eq(workspaceFolders.parentId, parentId) : isNull(workspaceFolders.parentId)
          )
        )
        .limit(1);
      if (dupRows.length > 0) return badRequest("같은 이름의 폴더가 이미 존재합니다");

      const inserted: any = await db
        .insert(workspaceFolders)
        .values({
          parentId: parentId,
          name,
          ownerId: meId,
          path: pathInfo.path,
          depth: pathInfo.depth,
          isShared: false,
          description: body.description || null
        })
        .returning();

      const newFolder = inserted[0];

      await logAudit({
        actorMemberId: meId,
        action: "workspace.folder.create",
        targetType: "workspace_folder",
        targetId: newFolder.id,
        meta: { name, parentId, path: newFolder.path }
      });

      return ok(newFolder, "폴더가 생성되었습니다");
    }

    /* =========================
       PATCH — 수정/복원
       ========================= */
    if (method === "PATCH") {
      const id = Number(url.searchParams.get("id") || 0);
      if (!id) return badRequest("id 필수");
      const action = url.searchParams.get("action");

      const folder = await getFolder(id);
      if (!folder) return notFound("폴더를 찾을 수 없습니다");

      const canEdit = isSuperAdmin || folder.ownerId === meId;
      if (!canEdit) return forbidden("수정 권한이 없습니다");

      // 복원
      if (action === "restore") {
        if (!folder.deletedAt) return badRequest("이미 활성 상태입니다");
        await db
          .update(workspaceFolders)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(eq(workspaceFolders.id, id));
        await logAudit({
          actorMemberId: meId,
          action: "workspace.folder.restore",
          targetType: "workspace_folder",
          targetId: id,
          meta: { name: folder.name }
        });
        return ok({ id }, "폴더가 복원되었습니다");
      }

      // 공개 토글
      if (action === "toggle-public") {
        const newVal = !folder.isShared;
        await db
          .update(workspaceFolders)
          .set({ isShared: newVal, updatedAt: new Date() })
          .where(eq(workspaceFolders.id, id));
        await logAudit({
          actorMemberId: meId,
          action: "workspace.folder.toggle_public",
          targetType: "workspace_folder",
          targetId: id,
          meta: { name: folder.name, isShared: newVal }
        });
        return ok({ id, isShared: newVal }, newVal ? "공개로 전환" : "비공개로 전환");
      }

      if (folder.deletedAt) return badRequest("삭제된 폴더입니다. 먼저 복원하세요");

      const body = await parseJson<any>(req);
      if (!body) return badRequest("body 필수");

      const updateData: any = { updatedAt: new Date() };
      let renamed = false;
      let moved = false;
      let newParentId = folder.parentId;
      let newName = folder.name;

      if (body.name !== undefined) {
        const sanitized = sanitizeName(body.name);
        if (!sanitized) return badRequest("name 비어있음");
        if (sanitized !== folder.name) {
          newName = sanitized;
          updateData.name = sanitized;
          renamed = true;
        }
      }

      if (body.parentId !== undefined) {
        const np = body.parentId ? Number(body.parentId) : null;
        if (np !== folder.parentId) {
          if (np === id) return badRequest("자기 자신을 부모로 지정할 수 없습니다");
          if (np) {
            const newParent = await getFolder(np);
            if (!newParent) return notFound("새 부모 폴더를 찾을 수 없습니다");
            if (newParent.deletedAt) return badRequest("삭제된 폴더로 이동할 수 없습니다");
            // 자기 자손으로 이동 방지
            const descendants = await getDescendantFolderIds(id);
            if (descendants.includes(np)) return badRequest("자기 자손으로 이동할 수 없습니다");
          }
          newParentId = np;
          updateData.parentId = np;
          moved = true;
        }
      }

      if (body.description !== undefined) {
        updateData.description = body.description || null;
      }

      // path/depth 재계산 (renamed 또는 moved 시)
      if (renamed || moved) {
        let newPath;
        try {
          newPath = await buildPath(newParentId, newName);
        } catch (e: any) {
          return badRequest(e.message);
        }
        updateData.path = newPath.path;
        updateData.depth = newPath.depth;

        // 동명 검증
        const dupRows: any = await db
          .select({ id: workspaceFolders.id })
          .from(workspaceFolders)
          .where(
            and(
              isNull(workspaceFolders.deletedAt),
              eq(workspaceFolders.name, newName),
              newParentId ? eq(workspaceFolders.parentId, newParentId) : isNull(workspaceFolders.parentId),
              sql`${workspaceFolders.id} != ${id}`
            )
          )
          .limit(1);
        if (dupRows.length > 0) return badRequest("같은 이름의 폴더가 이미 존재합니다");

        // 자손들의 path 일괄 업데이트
        const oldPathPrefix = folder.path || "";
        const newPathPrefix = newPath.path;
        if (oldPathPrefix && oldPathPrefix !== newPathPrefix) {
          await db.execute(sql`
            UPDATE workspace_folders
            SET path = ${newPathPrefix} || SUBSTRING(path FROM ${oldPathPrefix.length + 1}),
                depth = depth + ${newPath.depth - (folder.depth || 0)},
                updated_at = NOW()
            WHERE path LIKE ${oldPathPrefix + "/%"}
              AND deleted_at IS NULL
          `);
        }
      }

      const updated: any = await db
        .update(workspaceFolders)
        .set(updateData)
        .where(eq(workspaceFolders.id, id))
        .returning();

      await logAudit({
        actorMemberId: meId,
        action: "workspace.folder.update",
        targetType: "workspace_folder",
        targetId: id,
        meta: { renamed, moved, newName, newParentId }
      });

      return ok(updated[0], "폴더가 수정되었습니다");
    }

    /* =========================
       DELETE
       ========================= */
    if (method === "DELETE") {
      const id = Number(url.searchParams.get("id") || 0);
      if (!id) return badRequest("id 필수");
      const hard = url.searchParams.get("hard") === "1";

      const folder = await getFolder(id);
      if (!folder) return notFound("폴더를 찾을 수 없습니다");

      const canDel = isSuperAdmin || folder.ownerId === meId;
      if (!canDel) return forbidden("삭제 권한이 없습니다");

      // 자손 ID 수집
      const allIds = await getDescendantFolderIds(id);

      if (hard) {
        // 영구 삭제 (R2 정리는 향후 cron, 일단 DB에서만)
        if (allIds.length > 0) {
          await db.delete(workspaceFiles).where(inArray(workspaceFiles.folderId, allIds));
          await db.delete(workspaceFileShares).where(
            and(
              eq(workspaceFileShares.targetType, "folder"),
              inArray(workspaceFileShares.targetId, allIds)
            )
          );
          await db.delete(workspaceFolders).where(inArray(workspaceFolders.id, allIds));
        }
        await logAudit({
          actorMemberId: meId,
          action: "workspace.folder.delete.hard",
          targetType: "workspace_folder",
          targetId: id,
          meta: { name: folder.name, descendantCount: allIds.length }
        });
        return ok({ id, deletedFolders: allIds.length }, "영구 삭제되었습니다");
      }

      // soft delete (재귀)
      const now = new Date();
      if (allIds.length > 0) {
        await db
          .update(workspaceFolders)
          .set({ deletedAt: now, updatedAt: now })
          .where(inArray(workspaceFolders.id, allIds));
        await db
          .update(workspaceFiles)
          .set({ deletedAt: now, updatedAt: now })
          .where(inArray(workspaceFiles.folderId, allIds));
      }

      await logAudit({
        actorMemberId: meId,
        action: "workspace.folder.delete.soft",
        targetType: "workspace_folder",
        targetId: id,
        meta: { name: folder.name, descendantCount: allIds.length }
      });

      return ok({ id, softDeleted: allIds.length }, "휴지통으로 이동되었습니다");
    }

    return methodNotAllowed("GET / POST / PATCH / DELETE 만 허용");
  } catch (err: any) {
    console.error("[admin-workspace-folders]", err);
    return serverError("폴더 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin-workspace-folders" };
