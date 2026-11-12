/**
 * POST /api/memorial-letter-photo — 기억의 편지에 붙일 사진 올리기 (로그인 없이 누구나)
 *
 * ★ 2026-11-12 Swain 결정: 누구나 편지에 사진 한 장을 붙인다 / 사진이 붙은 편지는 운영자가 확인한 뒤 공개
 *
 * 요청: multipart/form-data — file (사진 한 장)
 * 응답: 201 { ok, data: { photo: { id, token, width, height } } }
 *   · id·token 을 편지 보내기(POST /api/memorial-letters)에 photoBlobId·photoToken 으로 함께 낸다.
 *   · 사진은 비공개로 저장된다 — 운영자가 [공개]를 누르기 전에는 /api/blob-image 가 관리자에게만 내준다.
 *
 * 지키는 것
 *   · JPG·PNG·WEBP 만 받는다(파일 이름·종류 표시가 아니라 파일 머리 바이트로 확인). 5MB 이하.
 *     아이폰 HEIC·움직이는 GIF 는 바꾸는 방법을 안내하며 거절한다.
 *   · 저장 전에 다시 그려 위치(GPS)·기기 정보를 지우고, 실제로 그려지는 사진만 남긴다.
 *   · 남용 방지 — 같은 접속에서 10분 10장·하루 40장, 모든 접속을 합쳐 한 시간 120장(lib/memorial-letter-photo).
 *   · 차단된 회원은 올릴 수 없다(편지 보내기와 같은 원칙). 로그인이 만료된 분은 익명으로 받는다.
 *   · 저장 칸이 준비되기 전(마이그 전)에는 «준비 중» 400 — 편지에 붙일 수 없는 사진을 쌓지 않는다.
 *   · 올린 뒤 하루 안에 편지에 붙지 않으면 만료 표시(expires_at)가 남는다(고아 파일 구분용).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../../db";
import { blobUploads } from "../../db/schema";
import { requireActiveUser, extractToken } from "../../lib/auth";
import type { UserPayload } from "../../lib/auth";
import { clientIpHash } from "../../lib/client-ip";
import { getR2Client, R2_BUCKET } from "../../lib/r2-client";
import { deleteFromR2 } from "../../lib/r2-delete";
import {
  LETTER_PHOTO_CONTEXT, LETTER_PHOTO_MAX_BYTES,
  letterPhotoReady, sniffImageKind, uploaderTag, photoKeyPrefix,
  recentPhotoUploads, photoUploadBlockReason, signPhotoToken,
} from "../../lib/memorial-letter-photo";
import { cleanLetterPhoto } from "../../lib/memorial-letter-photo-image";

export const config = { path: "/api/memorial-letter-photo" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
/** 편지에 붙지 않은 사진을 고아로 볼 때까지 (편지에 붙으면 지워진다) */
const ORPHAN_HOURS = 24;

function json(status: number, body: unknown) {
  return new Response(jsonKST(body), { status, headers: JSON_HEADER });
}
function bad(error: string, status = 400) {
  return json(status, { ok: false, error });
}
function jsonError(step: string, err: any) {
  return json(500, {
    ok: false,
    error: "사진을 올리지 못했습니다. 잠시 뒤에 다시 시도해 주세요.",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method.toUpperCase() !== "POST") {
    return bad("지원하지 않는 메서드입니다", 405);
  }

  let step = "ready";
  let storedKey: string | null = null;
  try {
    /* 저장 칸이 아직 없으면(마이그 전) 사진을 받아도 편지에 붙일 수 없다 */
    if (!(await letterPhotoReady())) {
      return bad("사진 첨부는 준비 중입니다. 사진 없이 편지를 보내 주세요.");
    }

    /* 로그인 흔적이 있으면 회원으로 받되, 토큰이 만료된 것뿐이면 익명으로 받는다.
       단 차단된 분은 익명으로도 올릴 수 없다 (memorial-letters 와 같은 원칙). */
    step = "auth";
    let memberId: number | null = null;
    if (extractToken(req)) {
      const guard = await requireActiveUser(req);
      if (guard.ok) {
        memberId = (guard as { ok: true; user: UserPayload }).user.uid;
      } else {
        const blocked = (guard as { ok: false; res: Response }).res;
        if (blocked && blocked.status === 403) return blocked;
      }
    }

    step = "parse";
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return bad("사진 파일을 받지 못했습니다. 다시 붙여 주세요.");
    }
    const entry = form.get("file");
    if (!entry || typeof entry === "string") return bad("사진 파일이 없습니다. 사진을 골라 주세요.");
    const file = entry as File;
    if (!file.size) return bad("빈 파일입니다. 다른 사진을 붙여 주세요.");
    if (file.size > LETTER_PHOTO_MAX_BYTES) {
      return bad("사진은 5MB까지 붙일 수 있습니다. 크기를 줄여서 다시 붙여 주세요.", 413);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > LETTER_PHOTO_MAX_BYTES) {
      return bad("사진은 5MB까지 붙일 수 있습니다. 크기를 줄여서 다시 붙여 주세요.", 413);
    }

    /* 형식 — 파일 이름이나 종류 표시는 믿지 않고 실제 머리 바이트를 본다 */
    step = "sniff";
    const kind = sniffImageKind(bytes);
    if (kind === "heic") {
      return bad("아이폰 HEIC 사진은 아직 받을 수 없습니다. 사진을 JPG로 바꾸거나 화면을 캡처해서 붙여 주세요.", 415);
    }
    if (kind === "gif") {
      return bad("움직이는 사진(GIF)은 붙일 수 없습니다. JPG·PNG·WEBP 사진을 붙여 주세요.", 415);
    }
    if (kind !== "jpeg" && kind !== "png" && kind !== "webp") {
      return bad("사진 파일(JPG·PNG·WEBP)만 붙일 수 있습니다.", 415);
    }

    /* 남용 방지 — 같은 접속이 짧은 시간에 여러 번, 또는 전체가 한꺼번에 쏟아지면 막는다 */
    step = "rate";
    const tag = uploaderTag(clientIpHash(req));
    const blockReason = photoUploadBlockReason(await recentPhotoUploads(tag));
    if (blockReason) return bad(blockReason, 429);

    /* 다시 그리기 — 위치·기기 정보 지우기 + 실제 사진인지 확인 + 큰 사진 줄이기 */
    step = "clean";
    const clean = await cleanLetterPhoto(bytes);
    if (!clean.ok) return bad((clean as { ok: false; error: string }).error);
    const photo = clean as Extract<typeof clean, { ok: true }>;

    /* R2 저장 — 파일 이름은 «용도/올린 접속/시각_난수.jpg» (lib/r2-client 규칙과 같은 모양) */
    step = "store";
    const blobKey = `${photoKeyPrefix(tag)}${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${photo.ext}`;
    await getR2Client().send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: blobKey,
      Body: photo.bytes,
      ContentType: photo.mime,
    }));
    storedKey = blobKey;

    /* 기록 — 비공개로. 원래 파일 이름은 남기지 않는다(이름에 개인정보가 담길 수 있다) */
    step = "record";
    const insertData: any = {
      blobKey,
      originalName: `letter-photo.${photo.ext}`,
      mimeType: photo.mime,
      sizeBytes: photo.bytes.length,
      uploadedBy: memberId,
      uploadedByAdmin: null,
      context: LETTER_PHOTO_CONTEXT,
      isPublic: false,
      storageProvider: "r2",
      uploadStatus: "completed",
      expiresAt: new Date(Date.now() + ORPHAN_HOURS * 60 * 60 * 1000),
    };
    const [row] = await db.insert(blobUploads).values(insertData).returning({ id: blobUploads.id });
    const id = Number((row as any)?.id || 0);
    if (!id) throw new Error("사진 기록 번호를 읽지 못했습니다");
    storedKey = null;

    return json(201, {
      ok: true,
      data: {
        photo: {
          id,
          token: signPhotoToken(id),
          width: photo.width,
          height: photo.height,
        },
      },
    });
  } catch (err: any) {
    /* 파일은 올라갔는데 기록이 실패했으면 파일을 치운다 (주인 없는 파일 방지) */
    if (storedKey) {
      try { await deleteFromR2(storedKey); } catch { /* 조용히 */ }
    }
    return jsonError(step, err);
  }
}
