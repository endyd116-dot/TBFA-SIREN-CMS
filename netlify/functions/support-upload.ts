/**
 * POST /api/support/upload
 * 첨부파일 업로드 (Netlify Blobs)
 * - 가족관계증명서 등 증빙 서류
 * - 최대 10MB
 */
import { getStore } from "@netlify/blobs";
import { authenticateUser } from "../../lib/auth";
import {
  created, badRequest, unauthorized, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    const auth = authenticateUser(req);
    if (!auth) return unauthorized("로그인이 필요합니다");

    /* multipart/form-data 파싱 */
    const formData = await req.formData().catch(() => null);
    if (!formData) return badRequest("파일이 없습니다");

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return badRequest("유효한 파일이 아닙니다");
    }

    /* 검증 */
    if (file.size > MAX_SIZE) {
      return badRequest(`파일 크기는 ${MAX_SIZE / 1024 / 1024}MB 이하여야 합니다`);
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return badRequest("허용된 파일 형식: JPG, PNG, WEBP, PDF, DOC, DOCX");
    }

    /* 고유 키 생성: support/{userId}/{timestamp}-{filename} */
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
    const key = `support/${auth.uid}/${timestamp}-${safeName}`;

    /* Netlify Blobs에 저장 */
    const store = getStore({ name: "support-attachments", consistency: "strong" });
    const buffer = await file.arrayBuffer();
    await store.set(key, buffer, {
      metadata: {
        userId: String(auth.uid),
        userName: auth.name,
        originalName: file.name,
        mimeType: file.type,
        size: String(file.size),
        uploadedAt: new Date().toISOString(),
      },
    });

    await logUserAction(req, auth.uid, auth.name, "file_upload", {
      target: key,
      detail: { name: file.name, size: file.size, type: file.type },
    });

    return created(
      {
        key,
        originalName: file.name,
        size: file.size,
        mimeType: file.type,
      },
      "파일이 업로드되었습니다"
    );
  } catch (err) {
    console.error("[support-upload]", err);
    return serverError("파일 업로드 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/support/upload" };