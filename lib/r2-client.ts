// lib/r2-client.ts
// ★ Phase M-2.5: Cloudflare R2 (S3 호환) 클라이언트 래퍼
// - 환경변수: R2_ACCOUNT_ID, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET

import { S3Client } from "@aws-sdk/client-s3";

let _client: S3Client | null = null;

export function getR2Client(): S3Client {
  if (_client) return _client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint =
    process.env.R2_ENDPOINT ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error("[R2] 환경변수가 누락되었습니다 (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT)");
  }

  _client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false,
  });

  return _client;
}

export const R2_BUCKET: string = process.env.R2_BUCKET || "siren-uploads";

/* 안전한 파일명 생성 (S3 key) */
export function generateBlobKey(context: string, userId: number, originalName: string): string {
  const safeContext = String(context || "etc").replace(/[^a-z0-9_-]/gi, "").slice(0, 30) || "etc";
  const ext = (originalName.split(".").pop() || "bin")
    .toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  return `${safeContext}/${userId || 0}/${ts}_${rand}.${ext}`;
}