// netlify/functions/blob-presign.ts
// ★ Phase M-2.5: R2 직접 업로드용 Pre-signed PUT URL 발급
// - 클라이언트 → 이 API: 메타데이터만 전송 (파일 본문 X)
// - 응답: { id, uploadUrl, key }
// - 클라이언트 → uploadUrl로 직접 PUT (R2에 직접, 6MB 한도 우회)

import type { Context } from "@netlify/functions";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "../../db";
import { blobUploads } from "../../db/schema";
import { authenticateUser, authenticateAdmin } from "../../lib/auth";
import { getR2Client, R2_BUCKET, generateBlobKey } from "../../lib/r2-client";
import {
  ok, badRequest, unauthorized, serverError,
  corsPreflight, methodNotAllowed, parseJson
} from "../../lib/response";

export const config = { path: "/api/blob-presign" };

const IMAGE_MAX = 20 * 1024 * 1024;       // 20MB
const FILE_MAX  = 100 * 1024 * 1024;      // 100MB

const IMAGE_MIME = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const FILE_MIME = [
  ...IMAGE_MIME,
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/x-hwp",
  "application/haansofthwp",
  "application/vnd.hancom.hwp",
  "text/plain",
  "application/zip",
];

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const user = authenticateUser(req);
  const admin = !user ? authenticateAdmin(req) : null;
  if (!user && !admin) return unauthorized("로그인이 필요합니다");

  const body = await parseJson<any>(req);
  if (!body) return badRequest("JSON 파싱 실패");

  const originalName = String(body.originalName || "").slice(0, 500).trim();
  const mimeType = String(body.mimeType || "").slice(0, 100).trim();
  const sizeBytes = Number(body.sizeBytes || 0);
  const context = String(body.context || "editor").slice(0, 50);
  const isPublic = body.isPublic !== false;

  if (!originalName) return badRequest("originalName 필수");
  if (!mimeType) return badRequest("mimeType 필수");
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return badRequest("sizeBytes 유효하지 않음");

  /* MIME 화이트리스트 */
  if (!FILE_MIME.includes(mimeType)) {
    return badRequest(`지원하지 않는 파일 형식: ${mimeType}`);
  }

  /* 크기 검증 */
  const isImage = IMAGE_MIME.includes(mimeType);
  const limit = isImage ? IMAGE_MAX : FILE_MAX;
  if (sizeBytes > limit) {
    const limitMb = Math.floor(limit / 1024 / 1024);
    return badRequest(`파일 크기는 ${limitMb}MB 이하여야 합니다`);
  }

  try {
    const uid = (user as any)?.uid || (admin as any)?.uid || 0;
    const blobKey = generateBlobKey(context, uid, originalName);

    /* DB에 pending 레코드 생성 */
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const insertData: any = {
      blobKey,
      originalName,
      mimeType,
      sizeBytes,
      uploadedBy: (user as any)?.uid || null,
      uploadedByAdmin: (admin as any)?.uid || null,
      context,
      isPublic,
      storageProvider: "r2",
      uploadStatus: "pending",
      expiresAt,
    };

    const [row] = await db.insert(blobUploads).values(insertData).returning();

    /* Pre-signed PUT URL 발급 (15분 유효) */
    const client = getR2Client();
    const cmd = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: blobKey,
      ContentType: mimeType,
    });
    const uploadUrl = await getSignedUrl(client, cmd, { expiresIn: 900 });

    return ok({
      id: (row as any).id,
      uploadUrl,
      key: blobKey,
      expiresIn: 900,
    }, "Pre-signed URL 발급");
  } catch (e: any) {
    console.error("[blob-presign]", e);
    return serverError("Pre-signed URL 발급 실패", e);
  }
};