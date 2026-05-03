// netlify/functions/blob-upload.ts
// ★ Phase M-1: Toast UI Editor + 일반 첨부 공용 업로드 API
// - 사용자(siren_token) 또는 관리자(siren_admin_token) 모두 허용
// - Netlify Blobs 저장 + blob_uploads 테이블 기록
// - Toast UI Editor의 hooks.addImageBlobHook 응답 형식 호환

import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { db } from "../../db";
import { blobUploads } from "../../db/schema";
import { authenticateUser, authenticateAdmin } from "../../lib/auth";
import {
  ok, badRequest, unauthorized, serverError,
  corsPreflight, methodNotAllowed
} from "../../lib/response";

export const config = { path: "/api/blob-upload" };

const IMAGE_MAX = 5 * 1024 * 1024;       // 5MB
const FILE_MAX  = 10 * 1024 * 1024;      // 10MB

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
];

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  /* 인증: 사용자 또는 관리자 둘 중 하나라도 통과하면 OK */
  const user = authenticateUser(req);
  const admin = !user ? authenticateAdmin(req) : null;
  if (!user && !admin) return unauthorized("로그인이 필요합니다");

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const context = (formData.get("context") as string | null) || "editor";
    const isPublicStr = (formData.get("isPublic") as string | null) ?? "true";
    const isPublic = isPublicStr !== "false";

    if (!file) return badRequest("파일이 없습니다");

    /* MIME / 크기 검증 */
    const isImage = IMAGE_MIME.includes(file.type);
    const allowed = FILE_MIME.includes(file.type);
    if (!allowed) {
      return badRequest(`지원하지 않는 파일 형식입니다 (${file.type})`);
    }

    const limit = isImage ? IMAGE_MAX : FILE_MAX;
    if (file.size > limit) {
      const limitMb = Math.floor(limit / 1024 / 1024);
      return badRequest(`파일 크기는 ${limitMb}MB 이하여야 합니다`);
    }

    /* Blob 저장 */
    const store = getStore("blob-uploads");
    const ext = (file.name.split(".").pop() || "bin")
      .toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    const safeContext = String(context).replace(/[^a-z0-9_-]/gi, "").slice(0, 30) || "editor";
    const uid = (user as any)?.uid || (admin as any)?.uid || 0;
    const blobKey = `${safeContext}/${uid}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;

    const buffer = await file.arrayBuffer();
await store.set(blobKey, buffer, {
  metadata: { contentType: file.type },
});

    /* 7일 후 만료 (참조되지 않은 고아 파일 자동 정리 대상) */
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const insertData: any = {
      blobKey,
      originalName: file.name.slice(0, 500),
      mimeType: file.type,
      sizeBytes: file.size,
      uploadedBy: (user as any)?.uid || null,
      uploadedByAdmin: (admin as any)?.uid || null,
      context: safeContext,
      isPublic,
      expiresAt,
    };

    const [row] = await db.insert(blobUploads).values(insertData).returning();

    /* Toast UI Editor 호환 응답
       - editor.js는 data.url 을 사용하여 본문에 <img src="..."> 삽입
       - blob-image.ts가 이 URL을 처리 */
    const url = `/api/blob-image?id=${(row as any).id}`;

    return ok({
      id: (row as any).id,
      url,
      blobKey: (row as any).blobKey,
      originalName: (row as any).originalName,
      mimeType: (row as any).mimeType,
      sizeBytes: (row as any).sizeBytes,
      isImage,
    }, "업로드되었습니다");
  } catch (err) {
    console.error("[blob-upload]", err);
    return serverError("업로드 중 오류가 발생했습니다", err);
  }
};