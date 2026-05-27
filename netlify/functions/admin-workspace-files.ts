/**
 * Phase 3-extra: 워크스페이스 파일 CRUD (Step 3 + Step 4 통합)
 *
 * GET ?folderId=N      : 폴더별 파일
 * GET ?folderId=0      : 루트 파일
 * GET ?search=xxx      : ILIKE 검색
 * GET ?trash=1         : 휴지통
 * GET ?id=N            : 단건
 * PATCH ?id=N          : 이름/폴더이동/태그/설명
 * PATCH ?id=N&action=restore : 복원
 * PATCH ?id=N&action=toggle-public : isShared 토글
 * DELETE ?id=N         : soft delete
 * DELETE ?id=N&hard=1  : 영구 삭제 (R2 포함)
 */
import type { Context } from "@netlify/functions";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../../db";
import { workspaceFiles, workspaceFolders, workspaceFileShares } from "../../db/schema";
import { eq, and, or, isNull, isNotNull, sql, inArray, desc } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { getR2Client, R2_BUCKET } from "../../lib/r2-client";
import {
  ok, badRequest, forbidden, notFound, serverError,
  methodNotAllowed, parseJson
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

const MAX_NAME_LEN = 300;

function sanitizeName(name: string): string {
  return String(name || "").trim().replace(/[\\/:*?"<>|]/g, "_").slice(0, MAX_NAME_LEN);
}

async function checkFolderWriteAccess(folderId: number, meId: number, isSuperAdmin: boolean): Promise<boolean> {
  const rows: any = await db.select().from(workspaceFolders).where(eq(workspaceFolders.id, folderId)).limit(1);
  const folder = rows[0];
  if (!folder || folder.deletedAt) return false;
  if (isSuperAdmin || folder.ownerId === meId) return true;
  const shares: any = await db
    .select()
    .from(workspaceFileShares)
    .where(
      and(
        eq(workspaceFileShares.targetType, "folder"),
        eq(workspaceFileShares.targetId, folderId),
        or(eq(workspaceFileShares.sharedWith, meId), isNull(workspaceFileShares.sharedWith)),
        eq(workspaceFileShares.permission, "edit")
      )
    )
    .limit(1);
  return shares.length > 0;
}

export default async (req: Request, _ctx: Context) => {
  const method = req.method;

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;
    const meId = (auth.ctx.member as any).id as number;
    const isSuperAdmin = ((auth.ctx.member as any).role || "") === "super_admin";

    const url = new URL(req.url);

    /* =========================
       GET — 조회
       ========================= */
    if (method === "GET") {
      const id = url.searchParams.get("id");
      const folderIdParam = url.searchParams.get("folderId");
      const search = url.searchParams.get("search");
      const trash = url.searchParams.get("trash");
      const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);

      if (id) {
        const rows: any = await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, Number(id))).limit(1);
        const file = rows[0];
        if (!file) return notFound("파일을 찾을 수 없습니다");
        if (!isSuperAdmin && file.ownerId !== meId && !file.isShared) {
          const shares: any = await db
            .select()
            .from(workspaceFileShares)
            .where(
              and(
                eq(workspaceFileShares.targetType, "file"),
                eq(workspaceFileShares.targetId, file.id),
                or(eq(workspaceFileShares.sharedWith, meId), isNull(workspaceFileShares.sharedWith)),
                // ★ Q3-007 fix: 만료된 공유는 접근 불가 (expiresAt NULL=무기한)
                or(isNull(workspaceFileShares.expiresAt), sql`${workspaceFileShares.expiresAt} > NOW()`)
              )
            )
            .limit(1);
          if (shares.length === 0) return forbidden("접근 권한이 없습니다");
        }
        return ok(file);
      }

      if (trash === "1") {
        const where = isSuperAdmin
          ? isNotNull(workspaceFiles.deletedAt)
          : and(isNotNull(workspaceFiles.deletedAt), eq(workspaceFiles.ownerId, meId));
        const items: any = await db
          .select()
          .from(workspaceFiles)
          .where(where)
          .orderBy(desc(workspaceFiles.deletedAt))
          .limit(limit);
        return ok({ items, total: items.length });
      }

      const baseConds: any[] = [
        isNull(workspaceFiles.deletedAt),
        eq(workspaceFiles.uploadStatus, "completed")
      ];

      if (search) {
        const q = String(search).trim().slice(0, 100);
        if (q) {
          baseConds.push(
            sql`(${workspaceFiles.name} ILIKE ${`%${q}%`} OR COALESCE(${workspaceFiles.description}, '') ILIKE ${`%${q}%`})`
          );
        }
      } else if (folderIdParam !== null) {
        const folderId = folderIdParam && folderIdParam !== "0" ? Number(folderIdParam) : null;
        if (folderId === null) {
          baseConds.push(isNull(workspaceFiles.folderId));
        } else {
          baseConds.push(eq(workspaceFiles.folderId, folderId));
        }
      }

      let visibilityCond: any;
      if (!isSuperAdmin) {
        const sharedFileIdsRows: any = await db
          .select({ targetId: workspaceFileShares.targetId })
          .from(workspaceFileShares)
          .where(
            and(
              eq(workspaceFileShares.targetType, "file"),
              or(eq(workspaceFileShares.sharedWith, meId), isNull(workspaceFileShares.sharedWith))
            )
          );
        const sharedIds = sharedFileIdsRows.map((r: any) => r.targetId);
        const visConds: any[] = [
          eq(workspaceFiles.ownerId, meId),
          eq(workspaceFiles.isShared, true)
        ];
        if (sharedIds.length > 0) visConds.push(inArray(workspaceFiles.id, sharedIds));
        visibilityCond = or(...visConds);
      }

      const finalWhere = visibilityCond ? and(...baseConds, visibilityCond) : and(...baseConds);
      const items: any = await db
        .select()
        .from(workspaceFiles)
        .where(finalWhere)
        .orderBy(desc(workspaceFiles.updatedAt))
        .limit(limit);
      return ok({ items, total: items.length });
    }

    /* =========================
       PATCH — 수정/복원/공개토글
       ========================= */
    if (method === "PATCH") {
      const id = Number(url.searchParams.get("id") || 0);
      if (!id) return badRequest("id 필수");
      const action = url.searchParams.get("action");

      const rows: any = await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, id)).limit(1);
      const file = rows[0];
      if (!file) return notFound("파일을 찾을 수 없습니다");

      const canEdit = isSuperAdmin || file.ownerId === meId;
      if (!canEdit) return forbidden("수정 권한이 없습니다");

      // 복원
      if (action === "restore") {
        if (!file.deletedAt) return badRequest("이미 활성 상태입니다");
        await db
          .update(workspaceFiles)
          .set({ deletedAt: null, updatedAt: new Date() } as any)
          .where(eq(workspaceFiles.id, id));
        await logAudit({
          userId: meId,
          action: "workspace.file.restore",
          target: `workspace_file:${id}`,
          detail: { name: file.name }
        });
        return ok({ id }, "파일이 복원되었습니다");
      }

      // 공개 토글
      if (action === "toggle-public") {
        const newVal = !file.isShared;
        await db
          .update(workspaceFiles)
          .set({ isShared: newVal, updatedAt: new Date() } as any)
          .where(eq(workspaceFiles.id, id));
        await logAudit({
          userId: meId,
          action: "workspace.file.toggle_public",
          target: `workspace_file:${id}`,
          detail: { name: file.name, isShared: newVal }
        });
        return ok({ id, isShared: newVal }, newVal ? "공개로 전환" : "비공개로 전환");
      }

      if (file.deletedAt) return badRequest("삭제된 파일입니다. 먼저 복원하세요");

      const body = await parseJson<any>(req);
      if (!body) return badRequest("body 필수");

      const updateData: any = { updatedAt: new Date() };

      if (body.name !== undefined) {
        const n = sanitizeName(body.name);
        if (!n) return badRequest("name 비어있음");
        updateData.name = n;
      }

      if (body.folderId !== undefined) {
        const newFolderId = body.folderId ? Number(body.folderId) : null;
        if (newFolderId !== file.folderId) {
          if (newFolderId) {
            const canWrite = await checkFolderWriteAccess(newFolderId, meId, isSuperAdmin);
            if (!canWrite) return forbidden("대상 폴더에 쓰기 권한이 없습니다");
          }
          updateData.folderId = newFolderId;
        }
      }

      if (body.description !== undefined) {
        updateData.description = body.description ? String(body.description).slice(0, 1000) : null;
      }

      if (body.tags !== undefined) {
        updateData.tags = Array.isArray(body.tags) ? body.tags.slice(0, 20) : [];
      }

      const updated: any = await db
        .update(workspaceFiles)
        .set(updateData as any)
        .where(eq(workspaceFiles.id, id))
        .returning();

      await logAudit({
        userId: meId,
        action: "workspace.file.update",
        target: `workspace_file:${id}`,
        detail: { name: file.name, changes: Object.keys(updateData) }
      });

      return ok(updated[0], "파일이 수정되었습니다");
    }

    /* =========================
       DELETE — soft / hard
       ========================= */
    if (method === "DELETE") {
      const id = Number(url.searchParams.get("id") || 0);
      if (!id) return badRequest("id 필수");
      const hard = url.searchParams.get("hard") === "1";

      const rows: any = await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, id)).limit(1);
      const file = rows[0];
      if (!file) return notFound("파일을 찾을 수 없습니다");

      const canDel = isSuperAdmin || file.ownerId === meId;
      if (!canDel) return forbidden("삭제 권한이 없습니다");

      if (hard) {
        // R2 삭제
        try {
          const client = getR2Client();
          await client.send(new DeleteObjectCommand({
            Bucket: R2_BUCKET,
            Key: file.r2Key
          }));
        } catch (e: any) {
          console.warn("[ws-file-delete] R2 삭제 실패 (계속 진행):", e?.message);
        }
        // 공유 레코드 정리
        await db.delete(workspaceFileShares).where(
          and(
            eq(workspaceFileShares.targetType, "file"),
            eq(workspaceFileShares.targetId, id)
          )
        );
        // DB 삭제
        await db.delete(workspaceFiles).where(eq(workspaceFiles.id, id));
        await logAudit({
          userId: meId,
          action: "workspace.file.delete.hard",
          target: `workspace_file:${id}`,
          detail: { name: file.name, r2Key: file.r2Key }
        });
        return ok({ id }, "영구 삭제되었습니다");
      }

      // soft
      await db
        .update(workspaceFiles)
        .set({ deletedAt: new Date(), updatedAt: new Date() } as any)
        .where(eq(workspaceFiles.id, id));
      await logAudit({
        userId: meId,
        action: "workspace.file.delete.soft",
        target: `workspace_file:${id}`,
        detail: { name: file.name }
      });
      return ok({ id }, "휴지통으로 이동되었습니다");
    }

    return methodNotAllowed("GET / PATCH / DELETE 만 허용");
  } catch (err: any) {
    console.error("[admin-workspace-files]", err);
    return serverError("파일 처리 중 오류", err);
  }
};

export const config = { path: "/api/admin-workspace-files" };
