// netlify/functions/blob-confirm.ts
// ★ Phase M-2.5: R2 업로드 완료 후 호출되는 확인 API
// - HEAD 요청으로 R2에 실제 업로드되었는지 검증
// - upload_status: pending → completed 갱신
// - 실제 size/type 동기화

import type { Context } from "@netlify/functions";
import { eq, and } from "drizzle-orm";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../../db";
import { blobUploads } from "../../db/schema";
import { authenticateUser, authenticateAdmin } from "../../lib/auth";
import { getR2Client, R2_BUCKET } from "../../lib/r2-client";
import {
  ok, badRequest, unauthorized, forbidden, notFound, serverError,
  corsPreflight, methodNotAllowed, parseJson
} from "../../lib/response";

export const config = { path: "/api/blob-confirm" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const user = authenticateUser(req);
  const admin = !user ? authenticateAdmin(req) : null;
  if (!user && !admin) return unauthorized("로그인이 필요합니다");

  const body = await parseJson<any>(req);
  if (!body || !Number.isFinite(Number(body.id))) return badRequest("id 필수");

  const id = Number(body.id);

  try {
    const [row] = await db.select().from(blobUploads).where(eq(blobUploads.id, id)).limit(1);
    if (!row) return notFound("업로드 레코드를 찾을 수 없습니다");

    /* 본인 업로드만 확인 가능 (관리자는 무제한) */
    if (!admin) {
      const ownerId = (user as any)?.uid;
      if ((row as any).uploadedBy !== ownerId) return forbidden("권한 없음");
    }

    if ((row as any).storageProvider !== "r2") {
      return badRequest("R2 업로드가 아닙니다");
    }

    /* R2 HEAD로 업로드 확인 */
    const client = getR2Client();
    let actualSize = (row as any).sizeBytes;
    let actualType = (row as any).mimeType;

    try {
      const headRes = await client.send(new HeadObjectCommand({
        Bucket: R2_BUCKET,
        Key: (row as any).blobKey,
      }));
      if (headRes.ContentLength) actualSize = Number(headRes.ContentLength);
      if (headRes.ContentType) actualType = headRes.ContentType;
    } catch (e: any) {
      /* 객체가 없으면 업로드 실패 */
      const code = e?.$metadata?.httpStatusCode;
      if (code === 404) {
        await db.update(blobUploads)
          .set({ uploadStatus: "failed" } as any)
          .where(eq(blobUploads.id, id));
        return badRequest("R2에 파일이 업로드되지 않았습니다");
      }
      throw e;
    }

    /* 갱신 */
    const updateData: any = {
      uploadStatus: "completed",
      sizeBytes: actualSize,
      mimeType: actualType,
    };
    await db.update(blobUploads).set(updateData).where(eq(blobUploads.id, id));

    return ok({
      id,
      url: `/api/blob-image?id=${id}`,
      originalName: (row as any).originalName,
      mimeType: actualType,
      sizeBytes: actualSize,
      isImage: String(actualType).startsWith("image/"),
    }, "업로드 확인 완료");
  } catch (e: any) {
    console.error("[blob-confirm]", e);
    return serverError("확인 실패", e);
  }
};