/**
 * Phase 3-extra: 워크스페이스 파일 목록/검색
 *
 * GET ?folderId=N      : 폴더별 파일
 * GET ?folderId=0      : 루트 파일 (folder_id IS NULL)
 * GET ?search=xxx      : ILIKE 검색 (name + description)
 * GET ?trash=1         : 휴지통
 * GET ?id=N            : 파일 단건
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { workspaceFiles, workspaceFolders, workspaceFileShares } from "../../db/schema";
import { eq, and, or, isNull, isNotNull, sql, inArray, desc } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, serverError, methodNotAllowed
} from "../../lib/response";

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.response;
    const meId = (auth.ctx.member as any).id as number;
    const isSuperAdmin = ((auth.ctx.member as any).role || "") === "super_admin";

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const folderIdParam = url.searchParams.get("folderId");
    const search = url.searchParams.get("search");
    const trash = url.searchParams.get("trash");
    const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);

    // 단건
    if (id) {
      const rows: any = await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, Number(id))).limit(1);
      const file = rows[0];
      if (!file) return notFound("파일을 찾을 수 없습니다");
      if (!isSuperAdmin && file.ownerId !== meId && !file.isShared) {
        // 명시적 공유 확인
        const shares: any = await db
          .select()
          .from(workspaceFileShares)
          .where(
            and(
              eq(workspaceFileShares.targetType, "file"),
              eq(workspaceFileShares.targetId, file.id),
              or(eq(workspaceFileShares.sharedWith, meId), isNull(workspaceFileShares.sharedWith))
            )
          )
          .limit(1);
        if (shares.length === 0) return forbidden("접근 권한이 없습니다");
      }
      return ok(file);
    }

    // 휴지통
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

    // 공통: 완료 상태만 + 미삭제
    const baseConds: any[] = [
      isNull(workspaceFiles.deletedAt),
      eq(workspaceFiles.uploadStatus, "completed")
    ];

    // 검색
    if (search) {
      const q = String(search).trim().slice(0, 100);
      if (q) {
        baseConds.push(
          sql`(${workspaceFiles.name} ILIKE ${`%${q}%`} OR COALESCE(${workspaceFiles.description}, '') ILIKE ${`%${q}%`})`
        );
      }
    } else if (folderIdParam !== null) {
      // 폴더 필터 (0 또는 빈 문자열 = 루트)
      const folderId = folderIdParam && folderIdParam !== "0" ? Number(folderIdParam) : null;
      if (folderId === null) {
        baseConds.push(isNull(workspaceFiles.folderId));
      } else {
        baseConds.push(eq(workspaceFiles.folderId, folderId));
      }
    }

    // 권한 스코프
    let visibilityCond: any;
    if (isSuperAdmin) {
      visibilityCond = undefined;
    } else {
      // 내 파일 + is_shared + 명시적 공유
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
  } catch (err: any) {
    console.error("[admin-workspace-files]", err);
    return serverError("파일 조회 실패", err);
  }
};

export const config = { path: "/api/admin-workspace-files" };
