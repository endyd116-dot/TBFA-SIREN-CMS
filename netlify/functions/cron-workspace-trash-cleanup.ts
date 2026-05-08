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
import { lt, isNotNull, and, eq } from "drizzle-orm";
import { db } from "../../db";
import { workspaceFiles, workspaceFolders } from "../../db/schema";
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
        if (file.r2Key) {
          const r = await deleteFromR2(file.r2Key);
          if (r.success) r2Deleted++;
          else {
            r2Failed++;
            errors.push(`R2: ${file.name} (${r.error})`);
          }
        }
        await db.delete(workspaceFiles).where(eq(workspaceFiles.id, file.id));
        filesPurged++;
      } catch (e: any) {
        errors.push(`File ${file.id}: ${e?.message || "unknown"}`);
      }
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

    const durationMs = Date.now() - startedAt;

    /* 3. 감사 로그 */
    try {
      await logAudit({
        memberId: 0,
        action: "CRON_WORKSPACE_TRASH_CLEANUP",
        targetType: "workspace_trash",
        targetId: 0,
        detail: {
          cutoffDate: cutoffISO,
          retentionDays: RETENTION_DAYS,
          filesProcessed,
          filesPurged,
          r2Deleted,
          r2Failed,
          foldersPurged,
          durationMs,
          errors: errors.slice(0, 20),
        },
      } as any);
    } catch (e) {
      console.warn("[cron-trash] audit failed:", e);
    }

    /* 4. 처리 결과 요약 */
    console.log(`[cron-trash] 완료: 파일 ${filesPurged}/${filesProcessed}, 폴더 ${foldersPurged}, R2 ${r2Deleted}/${r2Failed}, ${durationMs}ms`);

    return new Response(
      JSON.stringify({
        ok: true,
        filesProcessed,
        filesPurged,
        r2Deleted,
        r2Failed,
        foldersPurged,
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
