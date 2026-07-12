/**
 * 지출 증빙 파일 업로드용 Pre-signed PUT URL 발급
 * POST body: { fileName, contentType, sizeBytes? }
 * 응답: { ok, data: { uploadUrl, fileUrl, id, key, expiresIn } }
 *
 * 흐름:
 *   1. 프론트 → 이 API: 파일 메타데이터 전송
 *   2. 서버: blob_uploads INSERT (pending) + R2 presigned PUT URL 발급
 *   3. 프론트 → uploadUrl 로 PUT (파일 본문)
 *   4. 프론트 → /api/blob-confirm 호출 (uploadStatus: pending → completed)
 *   5. expenses.receipt_url 에 fileUrl 저장
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "../../db";
import { blobUploads } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { getR2Client, R2_BUCKET, generateBlobKey } from "../../lib/r2-client";

export const config = { path: "/api/admin-expense-receipt-presign" };

const FILE_MAX = 50 * 1024 * 1024; // 50MB (영수증·PDF·이미지)

const ALLOWED_MIME = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/x-hwp",
  "application/haansofthwp",
  "application/vnd.hancom.hwp",
];

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(jsonKST({ ok: false, error: "요청 본문 파싱 실패", step: "parse" }), { status: 400 });
  }

  const fileName = String(body.fileName || "").slice(0, 300).trim();
  const contentType = String(body.contentType || "").slice(0, 100).trim();
  const sizeBytes = body.sizeBytes !== undefined ? Number(body.sizeBytes) : null;

  if (!fileName) {
    return new Response(jsonKST({ ok: false, error: "fileName 필수", step: "validate" }), { status: 400 });
  }
  if (!contentType) {
    return new Response(jsonKST({ ok: false, error: "contentType 필수", step: "validate" }), { status: 400 });
  }
  if (!ALLOWED_MIME.includes(contentType)) {
    return new Response(jsonKST({
      ok: false, error: `지원하지 않는 파일 형식: ${contentType} (jpg/png/gif/webp/pdf/xlsx/hwp 만 가능)`, step: "validate_mime",
    }), { status: 400 });
  }
  if (sizeBytes !== null && (!Number.isFinite(sizeBytes) || sizeBytes <= 0)) {
    return new Response(jsonKST({ ok: false, error: "sizeBytes 유효하지 않음", step: "validate_size" }), { status: 400 });
  }
  if (sizeBytes !== null && sizeBytes > FILE_MAX) {
    return new Response(jsonKST({
      ok: false, error: `파일 크기는 ${FILE_MAX / 1024 / 1024}MB 이하여야 합니다`, step: "validate_size",
    }), { status: 400 });
  }

  const adminUid = auth.ctx.admin.uid ?? 0;

  try {
    const blobKey = generateBlobKey("expense-receipt", adminUid, fileName);

    const insertData: any = {
      blobKey,
      originalName: fileName,
      mimeType: contentType,
      sizeBytes: sizeBytes ?? 0,
      uploadedBy: null,
      uploadedByAdmin: adminUid,
      context: "expense-receipt",
      isPublic: false,
      storageProvider: "r2",
      uploadStatus: "pending",
      expiresAt: null,
    };

    const [row] = await db.insert(blobUploads).values(insertData).returning();
    const id = (row as any).id;

    const client = getR2Client();
    const cmd = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: blobKey,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(client, cmd, { expiresIn: 900 });

    return new Response(jsonKST({
      ok: true,
      data: {
        id,
        uploadUrl,
        fileUrl: `/api/blob-image?id=${id}`,
        key: blobKey,
        expiresIn: 900,
      },
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "업로드 URL 발급 실패", step: "presign",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500 });
  }
};
