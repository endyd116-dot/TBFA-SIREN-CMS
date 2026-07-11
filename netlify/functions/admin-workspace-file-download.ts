/**
 * Phase 3-extra: 파일 다운로드 Pre-signed GET URL 발급
 * GET ?id=N
 * 응답: { downloadUrl, expiresIn, filename }
 */
import type { Context } from "@netlify/functions";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "../../db";
import { workspaceFiles, workspaceFileShares } from "../../db/schema";
import { eq, and, or, isNull, sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { getR2Client, R2_BUCKET } from "../../lib/r2-client";
import {
  ok, badRequest, forbidden, notFound, serverError, methodNotAllowed
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;
    const meId = (auth.ctx.member as any).id as number;
    const isSuperAdmin = ((auth.ctx.member as any).role || "") === "super_admin";

    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id") || 0);
    if (!id) return badRequest("id 필수");

    const rows: any = await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, id)).limit(1);
    const file = rows[0];
    if (!file) return notFound("파일을 찾을 수 없습니다");
    if (file.deletedAt) return notFound("삭제된 파일입니다");
    if (file.uploadStatus !== "completed") return badRequest("업로드가 완료되지 않았습니다");

    // 권한 체크 (Q3-042: file.isShared=전체공개 토글은 공유대상·만료와 무관하게 모든 운영자 허용 — 의도된 동작)
    let canAccess = isSuperAdmin || file.ownerId === meId || file.isShared;
    if (!canAccess) {
      const shares: any = await db
        .select()
        .from(workspaceFileShares)
        .where(
          and(
            eq(workspaceFileShares.targetType, "file"),
            eq(workspaceFileShares.targetId, id),
            or(eq(workspaceFileShares.sharedWith, meId), isNull(workspaceFileShares.sharedWith)),
            // Q3-007 fix: 만료된 공유는 접근 불가 (expiresAt NULL=무기한)
            or(isNull(workspaceFileShares.expiresAt), sql`${workspaceFileShares.expiresAt} > NOW()`)
          )
        )
        .limit(1);
      canAccess = shares.length > 0;
    }
    if (!canAccess) {
      // [감사#93] 이 파일이 첨부된 카드의 접근권자(소유/담당/지시/완료자)면 다운로드 허용 — 카드 첨부 공유가 실제로 동작하게
      const attach: any = await db.execute(sql`
        SELECT 1
          FROM workspace_task_attachments a
          JOIN workspace_tasks t ON t.id = a.task_id
         WHERE a.file_id = ${id}
           AND (t.member_id = ${meId} OR t.assigned_to = ${meId} OR t.assigned_by = ${meId} OR t.completed_by = ${meId})
         LIMIT 1
      `);
      const arows = attach?.rows ?? attach ?? [];
      if (arows.length > 0) canAccess = true;
    }
    if (!canAccess) return forbidden("접근 권한이 없습니다");

    // Pre-signed GET URL (15분)
    const client = getR2Client();
    const cmd = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: file.r2Key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`
    });
    const downloadUrl = await getSignedUrl(client, cmd, { expiresIn: 900 });

    // download_count++
    await db
      .update(workspaceFiles)
      .set({ downloadCount: sql`${workspaceFiles.downloadCount} + 1` } as any)
      .where(eq(workspaceFiles.id, id));

    await logAudit({
      userId: meId,
      action: "workspace.file.download",
      target: `workspace_file:${id}`,
      detail: { name: file.name }
    });

    return ok({
      downloadUrl,
      expiresIn: 900,
      filename: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes
    }, "다운로드 URL 발급");
  } catch (err: any) {
    console.error("[admin-workspace-file-download]", err);
    return serverError("다운로드 URL 발급 실패", err);
  }
};

export const config = { path: "/api/admin-workspace-file-download" };
