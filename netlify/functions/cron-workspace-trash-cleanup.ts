// netlify/functions/cron-workspace-trash-cleanup.ts
// ★ Phase 3-extra Step 8: 매일 KST 03:00 휴지통 30일 경과 자동 영구삭제
//
// Schedule: "0 18 * * *" (UTC 18:00 = KST 03:00 다음날 새벽)
//   → 결과적으로 매일 KST 03:00에 1회 실행
//
// 로직:
// 1. workspace_files: deletedAt < now - 30days → R2 삭제 + DB hard delete
// 2. workspace_folders: deletedAt < now - 30days → DB hard delete
// 3. 감사 로그 + 슈퍼관리자 알림

import type { Context } from "@netlify/functions";
import { lt, isNotNull, and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { workspaceFiles, workspaceFolders, blobUploads } from "../../db/schema";
import { deleteFromR2 } from "../../lib/r2-delete";
import { logAudit } from "../../lib/audit";

const RETENTION_DAYS = 30;

export default async (req: Request, context: Context) => {
  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoffISO = cutoff.toISOString();

  let filesProcessed = 0;
  let filesPurged = 0;
  let r2Deleted = 0;
  let r2Failed = 0;
  let foldersPurged = 0;
  let blobOrphansDeleted = 0;
  let staleUploadsPurged = 0;
  const errors: string[] = [];

  try {
    /* 1. 30일 경과 파일 처리 */
    const targetFiles: any = await db
      .select()
      .from(workspaceFiles)
      .where(
        and(
          isNotNull(workspaceFiles.deletedAt),
          lt(workspaceFiles.deletedAt, cutoffISO as any)
        )
      );

    filesProcessed = (targetFiles as any[]).length;

    for (const file of (targetFiles as any[])) {
      try {
        let r2Ok = true;
        if (file.r2Key) {
          const r = await deleteFromR2(file.r2Key);
          if (r.success) r2Deleted++;
          else {
            r2Ok = false;
            r2Failed++;
            errors.push(`R2: ${file.name} (${r.error})`);
          }
        }
        // [감사#77] R2 삭제 실패 시 DB 행 보존 → 다음 크론에서 재시도(저장소 고아 방지)
        if (r2Ok) {
          await db.delete(workspaceFiles).where(eq(workspaceFiles.id, file.id));
          filesPurged++;
        }
      } catch (e: any) {
        errors.push(`File ${file.id}: ${e?.message || "unknown"}`);
      }
    }

    /* 1.5 [감사#79] 24h 경과 pending/failed 업로드 정리 — presign 후 중단된 조각(목록·휴지통에 안 보여 수동 삭제 불가) */
    try {
      const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const staleRows: any = await db
        .select()
        .from(workspaceFiles)
        .where(and(
          inArray(workspaceFiles.uploadStatus, ["pending", "failed"]),
          lt(workspaceFiles.createdAt, staleCutoff as any)
        ));
      for (const f of (staleRows as any[])) {
        try {
          let r2Ok = true;
          if (f.r2Key) {
            const r = await deleteFromR2(f.r2Key);
            if (r.success) r2Deleted++;
            else { r2Ok = false; r2Failed++; errors.push(`R2(stale): ${f.name} (${r.error})`); }
          }
          if (r2Ok) { await db.delete(workspaceFiles).where(eq(workspaceFiles.id, f.id)); staleUploadsPurged++; }
        } catch (e: any) { errors.push(`Stale ${f.id}: ${e?.message || "unknown"}`); }
      }
    } catch (e: any) {
      console.warn("[cron-trash] stale upload 정리 실패:", e?.message || e);
      errors.push(`StaleUpload: ${e?.message || "unknown"}`);
    }

    /* 2. 30일 경과 폴더 처리 */
    const targetFolders: any = await db
      .select()
      .from(workspaceFolders)
      .where(
        and(
          isNotNull(workspaceFolders.deletedAt),
          lt(workspaceFolders.deletedAt, cutoffISO as any)
        )
      );

    for (const folder of (targetFolders as any[])) {
      try {
        await db.delete(workspaceFolders).where(eq(workspaceFolders.id, folder.id));
        foldersPurged++;
      } catch (e: any) {
        errors.push(`Folder ${folder.id}: ${e?.message || "unknown"}`);
      }
    }

    /* 3. workspace blob orphan 정리 — workspaceFiles hard delete 후 참조 없는 blob_uploads 삭제
          workspaceFiles.r2Key === blobUploads.blobKey 로 매칭 */
    try {
      const survivingKeys: any = await db
        .select({ r2Key: workspaceFiles.r2Key })
        .from(workspaceFiles);
      const keySet = new Set((survivingKeys as any[]).map((r: any) => r.r2Key).filter(Boolean));

      const workspaceBlobs: any = await db
        .select({ id: blobUploads.id, blobKey: blobUploads.blobKey })
        .from(blobUploads)
        .where(eq(blobUploads.context, "workspace"));

      const orphanIds = (workspaceBlobs as any[])
        .filter((r: any) => !keySet.has(r.blobKey))
        .map((r: any) => r.id);

      if (orphanIds.length > 0) {
        await db.delete(blobUploads).where(inArray(blobUploads.id, orphanIds));
        blobOrphansDeleted = orphanIds.length;
      }
    } catch (e: any) {
      console.warn("[cron-trash] blob orphan 정리 실패:", e?.message || e);
      errors.push(`BlobOrphan: ${e?.message || "unknown"}`);
    }

    const durationMs = Date.now() - startedAt;

    /* 4. 감사 로그 */
    try {
      await logAudit({
        userId: null,
        userType: "system",
        action: "CRON_WORKSPACE_TRASH_CLEANUP",
        target: "workspace_trash",   // ★ Q3-023 fix: logAudit 실제 필드(userId·target)로 교정 (시스템 작업 userId=null)
        detail: {
          cutoffDate: cutoffISO,
          retentionDays: RETENTION_DAYS,
          filesProcessed,
          filesPurged,
          r2Deleted,
          r2Failed,
          foldersPurged,
          blobOrphansDeleted,
          staleUploadsPurged,
          durationMs,
          errors: errors.slice(0, 20),
        },
      } as any);
    } catch (e) {
      console.warn("[cron-trash] audit failed:", e);
    }

    /* 5. 처리 결과 요약 */
    console.log(`[cron-trash] 완료: 파일 ${filesPurged}/${filesProcessed}, 폴더 ${foldersPurged}, R2 ${r2Deleted}/${r2Failed}, blob orphan ${blobOrphansDeleted}, stale ${staleUploadsPurged}, ${durationMs}ms`);

    return new Response(
      JSON.stringify({
        ok: true,
        filesProcessed,
        filesPurged,
        r2Deleted,
        r2Failed,
        foldersPurged,
        blobOrphansDeleted,
        staleUploadsPurged,
        durationMs,
        errorsCount: errors.length,
        errorsSample: errors.slice(0, 5),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[cron-trash] fatal:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "unknown" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config = {
  schedule: "0 18 * * *", // UTC 18:00 = KST 03:00
};
