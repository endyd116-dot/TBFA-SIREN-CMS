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
        eq(workspaceFileShares.permission, "edit"),
        // [감사#82] 만료된 폴더 공유는 쓰기 불가 (파일 공유와 정합)
        or(isNull(workspaceFileShares.expiresAt), sql`${workspaceFileShares.expiresAt} > NOW()`)
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
                // Q3-007 fix: 만료된 공유는 접근 불가 (expiresAt NULL=무기한)
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

      // 탭 필터 — [감사#75] '내 파일'(mine)·'공유받음'(shared) 서버 미구현이라 전체와 동일했음
      const mineTab = url.searchParams.get("mine") === "1";
      const sharedTab = url.searchParams.get("shared") === "1";

      // 접근 가능 폴더(소유 + 폴더공유·만료전)·공유 파일 집합 계산 — [감사#24] 폴더공유/소유 파일 가시성
      let accessibleFolderIds: number[] = [];
      let sharedFileIds: number[] = [];
      const needShares = !isSuperAdmin || sharedTab;
      if (needShares) {
        const ownedFolders: any = await db
          .select({ id: workspaceFolders.id })
          .from(workspaceFolders)
          .where(and(eq(workspaceFolders.ownerId, meId), isNull(workspaceFolders.deletedAt)));
        const sharedFolders: any = await db
          .select({ targetId: workspaceFileShares.targetId })
          .from(workspaceFileShares)
          .where(
            and(
              eq(workspaceFileShares.targetType, "folder"),
              or(eq(workspaceFileShares.sharedWith, meId), isNull(workspaceFileShares.sharedWith)),
              or(isNull(workspaceFileShares.expiresAt), sql`${workspaceFileShares.expiresAt} > NOW()`)
            )
          );
        accessibleFolderIds = [...new Set([
          ...ownedFolders.map((r: any) => r.id),
          ...sharedFolders.map((r: any) => r.targetId),
        ])].filter(Boolean) as number[];

        const sharedFileRows: any = await db
          .select({ targetId: workspaceFileShares.targetId })
          .from(workspaceFileShares)
          .where(
            and(
              eq(workspaceFileShares.targetType, "file"),
              or(eq(workspaceFileShares.sharedWith, meId), isNull(workspaceFileShares.sharedWith)),
              /* OP-036: 만료된 공유는 목록 가시성에서도 제외 — 단건 GET·다운로드(Q3-007)와 정합. */
              or(isNull(workspaceFileShares.expiresAt), sql`${workspaceFileShares.expiresAt} > NOW()`)
            )
          );
        sharedFileIds = sharedFileRows.map((r: any) => r.targetId).filter(Boolean) as number[];
      }

      let visibilityCond: any;
      if (mineTab) {
        // '내 파일' — 본인 소유만 (권한자 전원 동일)
        visibilityCond = eq(workspaceFiles.ownerId, meId);
      } else if (sharedTab) {
        // '공유받음' — 파일/폴더 공유 또는 전체공개, 본인 소유 제외
        const sc: any[] = [eq(workspaceFiles.isShared, true)];
        if (sharedFileIds.length > 0) sc.push(inArray(workspaceFiles.id, sharedFileIds));
        if (accessibleFolderIds.length > 0) sc.push(inArray(workspaceFiles.folderId, accessibleFolderIds));
        visibilityCond = and(or(...sc), sql`${workspaceFiles.ownerId} <> ${meId}`);
      } else if (!isSuperAdmin) {
        // '전체'(일반 운영자) — 소유 + 전체공개 + 파일공유 + 폴더공유/소유
        const visConds: any[] = [
          eq(workspaceFiles.ownerId, meId),
          eq(workspaceFiles.isShared, true)
        ];
        if (sharedFileIds.length > 0) visConds.push(inArray(workspaceFiles.id, sharedFileIds));
        if (accessibleFolderIds.length > 0) visConds.push(inArray(workspaceFiles.folderId, accessibleFolderIds));
        visibilityCond = or(...visConds);
      }
      // super_admin '전체' → visibilityCond 미설정(전부 조회)

      const finalWhere = visibilityCond ? and(...baseConds, visibilityCond) : and(...baseConds);
      /* OP-038: offset 페이지네이션 + 실제 total — 상한(500) 초과분에 '더 보기'로 도달 가능하게. */
      const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
      const totalRow: any = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(workspaceFiles)
        .where(finalWhere);
      const total = Number(totalRow[0]?.c ?? 0);
      const items: any = await db
        .select()
        .from(workspaceFiles)
        .where(finalWhere)
        .orderBy(desc(workspaceFiles.updatedAt))
        .limit(limit)
        .offset(offset);
      return ok({ items, total, offset, limit });
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
        // [감사#81] 소속 폴더가 삭제/부재면 홈(null)으로 이동 — 안 그러면 트리·검색 어디에도 안 보이는 유령
        let restoreFolderId = file.folderId;
        if (restoreFolderId) {
          const pf: any = await db
            .select({ id: workspaceFolders.id, deletedAt: workspaceFolders.deletedAt })
            .from(workspaceFolders).where(eq(workspaceFolders.id, restoreFolderId)).limit(1);
          if (!pf[0] || pf[0].deletedAt) restoreFolderId = null;
        }
        await db
          .update(workspaceFiles)
          .set({ deletedAt: null, folderId: restoreFolderId, updatedAt: new Date() } as any)
          .where(eq(workspaceFiles.id, id));
        await logAudit({
          userId: meId,
          action: "workspace.file.restore",
          target: `workspace_file:${id}`,
          detail: { name: file.name, reparentedToHome: restoreFolderId !== file.folderId }
        });
        return ok(
          { id, folderId: restoreFolderId },
          restoreFolderId !== file.folderId
            ? "파일을 복원했어요 (상위 폴더가 삭제되어 홈으로 이동)"
            : "파일이 복원되었습니다"
        );
      }

      // 공개 토글
      if (action === "toggle-public") {
        // [감사#23] 명시적 목표값 우선 — 반전 사고 방지(?value=1/0 또는 body.isShared). 없으면 기존 반전.
        let newVal = !file.isShared;
        const valueParam = url.searchParams.get("value");
        if (valueParam === "1" || valueParam === "0") {
          newVal = valueParam === "1";
        } else {
          const tb = await parseJson<any>(req).catch(() => null);
          if (tb && typeof tb.isShared === "boolean") newVal = tb.isShared;
        }
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
        // [감사#77] R2 삭제 성공 후에만 DB 삭제 — 실패 시 행 보존해 재시도(고아 파일 방지)
        let r2Ok = false;
        if (!file.r2Key) {
          r2Ok = true; // R2 객체 없음(pending 등) — DB만 정리
        } else {
          try {
            const client = getR2Client();
            await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: file.r2Key }));
            r2Ok = true;
          } catch (e: any) {
            console.warn("[ws-file-delete] R2 삭제 실패 (행 보존·재시도 예정):", e?.message);
          }
        }
        if (!r2Ok) {
          // DB 행 유지(휴지통 잔존) → 30일 크론·재호출에서 재시도
          return ok({ id, r2Deleted: false }, "저장소 파일 삭제에 실패했습니다. 기록을 보존했으니 잠시 후 다시 시도해 주세요");
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
        return ok({ id, r2Deleted: true }, "영구 삭제되었습니다");
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
