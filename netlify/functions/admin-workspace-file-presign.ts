/**
 * Phase 3-extra: 파일 업로드 Pre-signed PUT URL 발급
 * POST body: { folderId?, name, sizeBytes, mimeType, description?, tags? }
 * 응답: { fileId, uploadUrl, r2Key, expiresIn }
 */
import type { Context } from "@netlify/functions";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "../../db";
import { workspaceFiles, workspaceFolders, workspaceFileShares } from "../../db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { getR2Client, R2_BUCKET, generateBlobKey } from "../../lib/r2-client";
import {
  ok, badRequest, forbidden, notFound, serverError,
  corsPreflight, methodNotAllowed, parseJson
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

const FILE_MAX = 500 * 1024 * 1024; // 500MB

async function checkFolderWriteAccess(folderId: number, meId: number, isSuperAdmin: boolean): Promise<{ ok: boolean; folder?: any; error?: string }> {
  const rows: any = await db.select().from(workspaceFolders).where(eq(workspaceFolders.id, folderId)).limit(1);
  const folder = rows[0];
  if (!folder) return { ok: false, error: "폴더를 찾을 수 없습니다" };
  if (folder.deletedAt) return { ok: false, error: "삭제된 폴더입니다" };
  if (isSuperAdmin || folder.ownerId === meId) return { ok: true, folder };

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

  if (shares.length > 0) return { ok: true, folder };
  return { ok: false, error: "폴더에 쓰기 권한이 없습니다" };
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.res;
    const meId = (auth.ctx.member as any).id as number;
    const isSuperAdmin = ((auth.ctx.member as any).role || "") === "super_admin";

    const body = await parseJson<any>(req);
    if (!body) return badRequest("body 필수");

    const name = String(body.name || "").slice(0, 300).trim();
    const sizeBytes = Number(body.sizeBytes || 0);
    const mimeType = String(body.mimeType || "application/octet-stream").slice(0, 100);
    const folderId = body.folderId ? Number(body.folderId) : null;
    const description = body.description ? String(body.description).slice(0, 1000) : null;
    const tags = Array.isArray(body.tags) ? body.tags.slice(0, 20) : [];

    if (!name) return badRequest("name 필수");
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return badRequest("sizeBytes 유효하지 않음");
    if (sizeBytes > FILE_MAX) return badRequest(`파일 크기는 ${FILE_MAX / 1024 / 1024}MB 이하여야 합니다`);

    // 폴더 권한 체크
    if (folderId) {
      const res = await checkFolderWriteAccess(folderId, meId, isSuperAdmin);
      if (!res.ok) return forbidden(res.error || "권한 없음");
    }

    // ext 추출
    const ext = (name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);

    // R2 키 생성
    const r2Key = generateBlobKey("workspace-files", meId, name);

    // DB INSERT (pending)
    const inserted: any = await db
      .insert(workspaceFiles)
      .values({
        folderId: folderId,
        ownerId: meId,
        name,
        r2Key,
        sizeBytes,
        mimeType,
        ext,
        uploadStatus: "pending",
        downloadCount: 0,
        description,
        tags: tags as any,
        isShared: false
      })
      .returning();
    const newFile = inserted[0];

    // Pre-signed PUT URL (15분)
    const client = getR2Client();
    const cmd = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      ContentType: mimeType
    });
    const uploadUrl = await getSignedUrl(client, cmd, { expiresIn: 900 });

    await logAudit({
      actorMemberId: meId,
      action: "workspace.file.presign",
      targetType: "workspace_file",
      targetId: newFile.id,
      meta: { name, sizeBytes, mimeType, folderId }
    });

    return ok({
      fileId: newFile.id,
      uploadUrl,
      r2Key,
      expiresIn: 900
    }, "업로드 URL 발급");
  } catch (err: any) {
    console.error("[admin-workspace-file-presign]", err);
    return serverError("업로드 URL 발급 실패", err);
  }
};

export const config = { path: "/api/admin-workspace-file-presign" };
