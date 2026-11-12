/**
 * netlify/functions/admin-memorial-bgm-upload.ts
 * 추모관 배경 음악 — 음원 파일 올리기 (관리자 전용 · 권한 cms_memorial)
 *
 * 함수 요청 본문은 약 6MB가 한도라 큰 음원을 함수로 받지 않는다.
 * 브라우저가 R2로 직접 올리고(사전 서명 PUT), 이 함수는 앞뒤 확인만 한다.
 *
 *   POST { action: "presign", originalName, mimeType, sizeBytes }
 *     → { ok, data: { id, uploadUrl, contentType, maxBytes, expiresIn } }
 *     브라우저는 uploadUrl 로 파일을 PUT 한다 (헤더 Content-Type: contentType)
 *   POST { action: "confirm", id }
 *     → R2에 실제로 올라갔는지·크기를 확인 → { ok, data: { id, url, originalName, mimeType, sizeBytes } }
 *
 * 재생 주소 url = /api/blob-image?id=N
 *   blob-image 가 R2 사전 서명 주소로 넘겨준다(302, 형식은 audio/*로 지정).
 *   재생기는 그 주소로 구간 요청(Range)을 직접 보내므로 함수가 큰 파일을 중계하지 않는다.
 *
 * ※ 일반 회원용 업로드(blob-upload·blob-presign)의 허용 형식은 넓히지 않는다 — 음원은 이 관리자 경로로만.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { blobUploads } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { getR2Client, R2_BUCKET, generateBlobKey } from "../../lib/r2-client";
import { deleteFromR2 } from "../../lib/r2-delete";
import { logAdminAction } from "../../lib/audit";
import { BGM_UPLOAD_CONTEXT, BGM_UPLOAD_MAX_BYTES, resolveBgmUploadType } from "../../lib/memorial-bgm";

export const config = { path: "/api/admin-memorial-bgm-upload" };

const PUT_EXPIRES_SEC = 900;   // 사전 서명 PUT 주소 유효 15분
const MAX_MB = Math.round(BGM_UPLOAD_MAX_BYTES / 1024 / 1024);

function json(status: number, body: any) {
  return new Response(jsonKST(body), { status, headers: { "Content-Type": "application/json" } });
}
function jsonError(step: string, err: any) {
  return json(500, {
    ok: false,
    error: "음원 파일 올리기 처리 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "POST만 허용합니다", step: "method" });

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const admin = auth.ctx.admin;

  let body: any;
  try { body = await req.json(); } catch { body = null; }
  if (!body || typeof body !== "object") return json(400, { ok: false, error: "요청 본문을 읽지 못했습니다", step: "parse" });

  const action = String(body.action || "");
  if (action === "presign") return presign(req, body, admin);
  if (action === "confirm") return confirm(req, body, admin);
  return json(400, { ok: false, error: "action 은 presign 또는 confirm 이어야 합니다", step: "validate_action" });
};

/* ── 1단계: 올릴 주소 발급 ── */
async function presign(_req: Request, body: any, admin: { uid: number }) {
  const originalName = String(body.originalName || "").trim().slice(0, 300);
  const mimeType = String(body.mimeType || "").trim().slice(0, 100);
  const sizeBytes = Number(body.sizeBytes);

  if (!originalName) return json(400, { ok: false, error: "파일 이름이 없습니다", step: "validate_name" });
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return json(400, { ok: false, error: "파일 크기를 알 수 없습니다", step: "validate_size" });
  }
  if (sizeBytes > BGM_UPLOAD_MAX_BYTES) {
    return json(400, { ok: false, error: `음원 파일은 ${MAX_MB}MB 이하만 올릴 수 있습니다`, step: "validate_size" });
  }
  const type = resolveBgmUploadType(originalName, mimeType);
  if (!type.ok || !type.contentType) {
    return json(400, { ok: false, error: type.error || "올릴 수 없는 파일 형식입니다", step: "validate_type" });
  }
  const contentType = type.contentType;

  const adminUid = Number(admin?.uid) || 0;
  const blobKey = generateBlobKey(BGM_UPLOAD_CONTEXT, adminUid, originalName);

  /* 업로드 기록(대기) — 확인 단계에서 완료로 바꾼다. 확인 전에 끊긴 기록은 7일 뒤 만료 표시 */
  let id: number;
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    const insertData: any = {
      blobKey,
      originalName,
      mimeType: contentType,
      sizeBytes: Math.round(sizeBytes),
      uploadedBy: null,
      uploadedByAdmin: adminUid || null,
      context: BGM_UPLOAD_CONTEXT,
      isPublic: true,                 // 공개 추모관에서 재생
      storageProvider: "r2",
      uploadStatus: "pending",
      expiresAt,
    };
    const [row] = await db.insert(blobUploads).values(insertData).returning();
    id = Number((row as any)?.id);
    if (!id) throw new Error("업로드 기록 번호를 받지 못했습니다");
  } catch (err: any) {
    return jsonError("insert", err);
  }

  try {
    const cmd = new PutObjectCommand({ Bucket: R2_BUCKET, Key: blobKey, ContentType: contentType });
    const uploadUrl = await getSignedUrl(getR2Client(), cmd, { expiresIn: PUT_EXPIRES_SEC });
    return json(200, {
      ok: true,
      data: { id, uploadUrl, contentType, maxBytes: BGM_UPLOAD_MAX_BYTES, expiresIn: PUT_EXPIRES_SEC },
    });
  } catch (err: any) {
    try { await db.update(blobUploads).set({ uploadStatus: "failed" } as any).where(eq(blobUploads.id, id)); } catch { /* 보조 */ }
    return jsonError("presign", err);
  }
}

/* ── 2단계: 올라간 파일 확인 → 재생 주소 돌려주기 ── */
async function confirm(req: Request, body: any, admin: { uid: number; name?: string }) {
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, error: "id 필수", step: "validate_id" });

  let row: any;
  try {
    const rows = await db.select().from(blobUploads).where(eq(blobUploads.id, id)).limit(1);
    row = rows[0];
  } catch (err: any) {
    return jsonError("select", err);
  }
  if (!row) return json(404, { ok: false, error: "업로드 기록을 찾을 수 없습니다", step: "select" });
  if (row.context !== BGM_UPLOAD_CONTEXT || row.storageProvider !== "r2") {
    return json(400, { ok: false, error: "추모관 음원 업로드 기록이 아닙니다", step: "validate_row" });
  }

  const url = `/api/blob-image?id=${id}`;
  if (row.uploadStatus === "completed") {
    return json(200, { ok: true, data: { id, url, originalName: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes } });
  }

  const markFailed = async () => {
    try { await db.update(blobUploads).set({ uploadStatus: "failed" } as any).where(eq(blobUploads.id, id)); }
    catch (e) { console.warn("[admin-memorial-bgm-upload] failed 표시 실패", e); }
  };

  /* R2에 실제로 올라갔는지 — 사전 서명 PUT 은 크기를 강제하지 못하므로 여기서 실제 크기를 본다 */
  let size = 0;
  try {
    const head = await getR2Client().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: row.blobKey }));
    size = Number(head.ContentLength || 0);
  } catch (err: any) {
    const code = err?.$metadata?.httpStatusCode;
    if (code === 404 || err?.name === "NotFound") {
      await markFailed();
      return json(400, { ok: false, error: "파일이 올라가지 않았습니다. 다시 올려 주세요", step: "head_missing" });
    }
    return jsonError("head", err);
  }

  if (!(size > 0) || size > BGM_UPLOAD_MAX_BYTES) {
    await deleteFromR2(row.blobKey);
    await markFailed();
    return json(400, {
      ok: false,
      error: size > 0 ? `음원 파일은 ${MAX_MB}MB 이하만 올릴 수 있습니다` : "빈 파일입니다",
      step: "validate_uploaded_size",
    });
  }

  try {
    /* 완료 — 추모관 설정에 쓰는 파일이므로 만료 표시를 지운다(영구 보관) */
    await db.update(blobUploads)
      .set({ uploadStatus: "completed", sizeBytes: size, expiresAt: null } as any)
      .where(eq(blobUploads.id, id));
  } catch (err: any) {
    return jsonError("update", err);
  }

  await logAdminAction(req, Number(admin?.uid) || 0, String(admin?.name || ""), "memorial_bgm_upload", {
    target: `blob_uploads:${id}`,
    detail: { originalName: row.originalName, mimeType: row.mimeType, sizeBytes: size },
  });

  return json(200, {
    ok: true,
    data: { id, url, originalName: row.originalName, mimeType: row.mimeType, sizeBytes: size },
  });
}
