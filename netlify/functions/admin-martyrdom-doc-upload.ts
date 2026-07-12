/**
 * admin-martyrdom-doc-upload — 자료 업로드 presign URL 발급
 *
 * POST { caseId, fileName, mimeType, sizeBytes }
 *   → blob_uploads INSERT (pending) + R2 presigned PUT URL 발급
 *   → martyrdom_case_documents row (pending) 생성
 *   → { ok, uploadUrl, blobKey, docId, expiresIn }
 *
 * docType 안 받음 — AI 자동분류 (§1.5)
 * 파일 형식 거부 없음 — hwp·pptx 포함 무엇이든 수용 (§1.5)
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "../../db";
import { blobUploads } from "../../db/schema";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { getR2Client, R2_BUCKET, generateBlobKey } from "../../lib/r2-client";

export const config = { path: "/api/admin-martyrdom-doc-upload" };

const FILE_MAX = 300 * 1024 * 1024; // 300MB (대용량 음성·영상 허용 — 장시간 녹취 등)
const PRESIGN_EXPIRES = 600; // 10분

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "업로드 URL 발급 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin } = auth.ctx;

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(jsonKST({ ok: false, error: "요청 본문 파싱 실패" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const caseId  = Number(body.caseId);
  const fileName = String(body.fileName || "").trim().slice(0, 500);
  const mimeType = String(body.mimeType || "application/octet-stream").slice(0, 100);
  const sizeBytes = body.sizeBytes != null ? Number(body.sizeBytes) : null;

  if (!caseId) {
    return new Response(jsonKST({ ok: false, error: "caseId 필수" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  if (!fileName) {
    return new Response(jsonKST({ ok: false, error: "fileName 필수" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  if (sizeBytes !== null && sizeBytes > FILE_MAX) {
    return new Response(jsonKST({
      ok: false, error: `파일 크기는 ${FILE_MAX / 1024 / 1024}MB 이하여야 합니다`,
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    /* 사건 존재 확인 */
    const caseCheck: any = await db.execute(sql.raw(`
      SELECT id FROM martyrdom_cases WHERE id = ${caseId} LIMIT 1
    `));
    if (!(caseCheck?.rows ?? caseCheck ?? []).length) {
      return new Response(jsonKST({ ok: false, error: "사건을 찾을 수 없습니다" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    /* R2 presigned PUT URL */
    const blobKey = generateBlobKey("martyrdom-doc", admin.uid, fileName);
    const client = getR2Client();
    const cmd = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: blobKey,
      ContentType: mimeType,
    });
    const uploadUrl = await getSignedUrl(client, cmd, { expiresIn: PRESIGN_EXPIRES });

    /* blob_uploads INSERT (pending) */
    const [blobRow] = await db.insert(blobUploads).values({
      blobKey,
      originalName: fileName,
      mimeType,
      sizeBytes: sizeBytes ?? 0,
      uploadedByAdmin: admin.uid,
      context: "martyrdom_doc",
      isPublic: false,
      storageProvider: "r2",
      uploadStatus: "pending",
    } as any).returning();
    const blobId = (blobRow as any).id;

    /* martyrdom_case_documents row (pending) */
    const docInserted: any = await db.execute(sql.raw(`
      INSERT INTO martyrdom_case_documents
        (case_id, blob_id, file_name, mime_type, size_bytes, extract_status, blob_key, created_by, updated_at)
      VALUES
        (${caseId}, ${blobId}, '${fileName.replace(/'/g, "''")}',
         '${mimeType.replace(/'/g, "''")}',
         ${sizeBytes ?? 0}, 'pending', '${blobKey.replace(/'/g, "''")}',
         ${admin.uid}, NOW())
      RETURNING id
    `));
    const docId = Number((docInserted?.rows ?? docInserted ?? [])[0]?.id);

    return new Response(jsonKST({
      ok: true,
      uploadUrl,
      blobKey,
      docId,
      expiresIn: PRESIGN_EXPIRES,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return jsonError("presign", err);
  }
};
