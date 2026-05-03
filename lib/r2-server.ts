// lib/r2-server.ts
// ★ Phase M-14: 서버 측에서 R2에 직접 업로드/다운로드 + blob_uploads에 자동 기록
// - PDF 영수증 / 자동 생성 이미지 등 서버에서 생성한 파일을 R2에 저장할 때 사용
// - 클라이언트 업로드(presign)와 별개

import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../db";
import { blobUploads } from "../db/schema";
import { getR2Client, R2_BUCKET, generateBlobKey } from "./r2-client";

/* ───────── 서버에서 R2에 파일 업로드 + DB 기록 ───────── */
export interface ServerUploadOptions {
  buffer: Uint8Array | Buffer;
  originalName: string;
  mimeType: string;
  context: string;                   // 'receipt' | 'stamp' 등
  uploadedByAdmin?: number | null;
  uploadedBy?: number | null;
  isPublic?: boolean;
  expiresInDays?: number | null;     // null이면 만료 없음 (기본 null)
}

export interface ServerUploadResult {
  ok: boolean;
  blobId?: number;
  blobKey?: string;
  url?: string;
  error?: string;
}

/**
 * 서버에서 생성한 파일(PDF/이미지)을 R2에 업로드하고 blob_uploads에 기록
 */
export async function uploadToR2(opts: ServerUploadOptions): Promise<ServerUploadResult> {
  try {
    const { buffer, originalName, mimeType, context } = opts;
    const uploadedBy = opts.uploadedBy ?? null;
    const uploadedByAdmin = opts.uploadedByAdmin ?? null;
    const isPublic = opts.isPublic !== false;

    if (!buffer || buffer.length === 0) {
      return { ok: false, error: "빈 파일입니다" };
    }

    /* R2 업로드 */
    const safeContext = String(context || "etc").replace(/[^a-z0-9_-]/gi, "").slice(0, 30) || "etc";
    const blobKey = generateBlobKey(safeContext, uploadedBy || uploadedByAdmin || 0, originalName);

    const client = getR2Client();
    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: blobKey,
      Body: buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as any),
      ContentType: mimeType || "application/octet-stream",
    }));

    /* 만료 시간 계산 */
    let expiresAt: Date | null = null;
    if (opts.expiresInDays !== null && opts.expiresInDays !== undefined) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + opts.expiresInDays);
    }

    /* DB 기록 (storage_provider='r2', upload_status='completed') */
    const insertData: any = {
      blobKey,
      originalName: originalName.slice(0, 500),
      mimeType,
      sizeBytes: buffer.length,
      uploadedBy,
      uploadedByAdmin,
      context: safeContext,
      isPublic,
      storageProvider: "r2",
      uploadStatus: "completed",
      expiresAt,
    };

    const [row] = await db.insert(blobUploads).values(insertData).returning();

    return {
      ok: true,
      blobId: (row as any).id,
      blobKey,
      url: `/api/blob-image?id=${(row as any).id}`,
    };
  } catch (e: any) {
    console.error("[r2-server.uploadToR2]", e);
    return { ok: false, error: e?.message || "업로드 실패" };
  }
}

/* ───────── R2에서 파일 다운로드 ───────── */
export async function downloadFromR2(blobKey: string): Promise<Uint8Array | null> {
  try {
    const client = getR2Client();
    const res = await client.send(new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: blobKey,
    }));

    if (!res.Body) return null;

    /* Body는 Readable | Blob | ReadableStream 중 하나 — Lambda Node.js 환경에서는 Readable */
    const chunks: Uint8Array[] = [];
    const stream = res.Body as any;

    /* AWS SDK v3는 transformToByteArray() 메서드 제공 */
    if (typeof stream.transformToByteArray === "function") {
      const bytes = await stream.transformToByteArray();
      return new Uint8Array(bytes);
    }

    /* fallback: stream 읽기 */
    for await (const chunk of stream) {
      chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    return merged;
  } catch (e: any) {
    console.error("[r2-server.downloadFromR2]", e);
    return null;
  }
}