/**
 * Phase 3-extra: 파일 업로드 완료 확인
 * POST body: { fileId, sha256? }
 * → R2 HEAD 확인 + status='completed'
 */
import type { Context } from "@netlify/functions";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../../db";
import { workspaceFiles } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { getR2Client, R2_BUCKET } from "../../lib/r2-client";
import {
  ok, badRequest, forbidden, notFound, serverError,
  corsPreflight, methodNotAllowed, parseJson
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.response;
    const meId = (auth.ctx.member as any).id as number;
    const isSuperAdmin = ((auth.ctx.member as any).role || "") === "super_admin";

    const body = await parseJson<any>(req);
    if (!body || !Number.isFinite(Number(body.fileId))) return badRequest("fileId 필수");
    const fileId = Number(body.fileId);
    const sha256 = body.sha256 ? String(body.sha256).slice(0, 64) : null;

    const rows: any = await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, fileId)).limit(1);
    const file = rows[0];
    if (!file) return notFound("파일을 찾을 수 없습니다");
    if (!isSuperAdmin && file.ownerId !== meId) return forbidden("권한 없음");

    // R2 HEAD
    const client = getR2Client();
    let actualSize = file.sizeBytes;
    let actualType = file.mimeType;

    try {
      const head = await client.send(new HeadObjectCommand({
        Bucket: R2_BUCKET,
        Key: file.r2Key
      }));
      if (head.ContentLength) actualSize = Number(head.ContentLength);
      if (head.ContentType) actualType = head.ContentType;
    } catch (e: any) {
      const code = e?.$metadata?.httpStatusCode;
      if (code === 404) {
        await db
          .update(workspaceFiles)
          .set({ uploadStatus: "failed", updatedAt: new Date() })
          .where(eq(workspaceFiles.id, fileId));
        return badRequest("R2에 파일이 업로드되지 않았습니다");
      }
      throw e;
    }

    const updateData: any = {
      uploadStatus: "completed",
      sizeBytes: actualSize,
      mimeType: actualType,
      updatedAt: new Date()
    };
    if (sha256) updateData.sha256 = sha256;

    const updated: any = await db
      .update(workspaceFiles)
      .set(updateData)
      .where(eq(workspaceFiles.id, fileId))
      .returning();

    await logAudit({
      actorMemberId: meId,
      action: "workspace.file.upload.confirm",
      targetType: "workspace_file",
      targetId: fileId,
      meta: { name: file.name, sizeBytes: actualSize }
    });

    return ok(updated[0], "업로드 완료");
  } catch (err: any) {
    console.error("[admin-workspace-file-confirm]", err);
    return serverError("업로드 확인 실패", err);
  }
};

export const config = { path: "/api/admin-workspace-file-confirm" };
