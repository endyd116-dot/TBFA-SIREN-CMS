/**
 * lib/memorial-letter-photo.ts — 기억의 편지에 붙는 사진 한 장
 *
 * ★ 2026-11-12 Swain 결정
 *   ① 누구나(로그인 없이) 편지에 사진 한 장을 붙일 수 있다.
 *   ② 사진이 붙은 편지는 운영자가 확인한 뒤 공개한다. 글만 있는 편지는 지금처럼 바로 공개.
 *   ③ 공개된 편지에 사진이 있으면 그 사진이 봉투의 표지가 되고, 편지를 열면 크게 보인다.
 *
 * 저장 칸 (migrate-memorial-letter-photo 로 추가)
 *   memorial_letters.photo_blob_id — 붙인 사진(blob_uploads.id). 사진이 없으면 null
 *   memorial_letters.photo_review  — 사진 검토 상태. 사진이 없으면 null
 *       pending  : 운영자 확인 대기 — 공개 목록·30통 집계에서 빠진다
 *       approved : 사진과 함께 공개 — 이때 사진 파일도 공개로 바뀐다
 *       rejected : 사진은 싣지 않음(사진 빼고 공개 또는 숨김) — 사진 파일은 비공개 그대로
 *
 *   «숨김»(is_hidden: 신고·운영자 숨김·글 자동 검토 보류)과는 따로 움직인다.
 *   공개 조건 = is_hidden 이 거짓 AND photo_review 가 pending 이 아님.
 *   그래서 운영자가 목록에서 [노출]을 눌러도 사진 검토가 끝나기 전에는 공개되지 않는다.
 *
 * 사진 파일은 올릴 때 비공개(blob_uploads.is_public = false)로 저장한다.
 *   → /api/blob-image 는 비공개 파일을 관리자에게만 내준다(로그인 없이 올린 사진은 주인이 없다).
 *   → 운영자가 [공개]를 누르는 순간 공개로 바뀌고, 숨김·삭제·사진 빼기 때는 다시 비공개가 된다.
 *
 * 새 칸은 직접 SQL로만 다룬다 — db/schema.ts 에는 마이그 적용 뒤에 넣는다(CLAUDE.md §6.7·§9.1.1).
 * 마이그 전에는 letterPhotoReady() 가 false → 모든 호출부가 «사진 없는 편지»처럼 동작한다.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";

/** blob_uploads.context 값 — 이 경로로 올라온 사진만 편지에 붙일 수 있다 */
export const LETTER_PHOTO_CONTEXT = "memorial-letter";
/** 올릴 수 있는 사진 크기 상한 */
export const LETTER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export type PhotoReview = "pending" | "approved" | "rejected";
/** 운영자 결정 — 공개(사진과 함께) · 사진 빼고 공개 · 숨김 */
export type PhotoDecision = "approve" | "strip" | "hide";
export const PHOTO_DECISIONS: PhotoDecision[] = ["approve", "strip", "hide"];

/** 올린 뒤 편지에 붙일 수 있는 시간 (이 안에 편지를 보내야 한다) */
const ATTACH_WINDOW_HOURS = 6;
const TOKEN_TTL_MS = ATTACH_WINDOW_HOURS * 60 * 60 * 1000;

/** 남용 방지 — 같은 접속(되돌릴 수 없게 섞은 값)·전체 기준 올리기 상한 */
export const PHOTO_UPLOAD_LIMITS = {
  /** 같은 접속에서 10분 안에 */
  ipShort: 10,
  /** 같은 접속에서 하루에 */
  ipDay: 40,
  /** 모든 접속을 합쳐 한 시간에 (접속을 바꿔 가며 쏟아붓는 경우를 막는 마지막 울타리) */
  globalHour: 120,
};

function rowsOf(r: any): any[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

/* ───────── 저장 칸 준비 여부 ─────────
   ★ "있음"만 기억한다. "없음"을 함수가 사는 동안 기억하면 운영자가 마이그를 호출한 뒤에도
   살아 있는 인스턴스가 계속 사진을 막는다. 없음일 때는 30초마다 다시 본다(memorial-letter-extras 와 같은 방식). */
let _ready = false;
let _lastMiss = 0;
const RECHECK_MS = 30 * 1000;

export async function letterPhotoReady(): Promise<boolean> {
  if (_ready) return true;
  if (Date.now() - _lastMiss < RECHECK_MS) return false;
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'memorial_letters'
         AND column_name IN ('photo_blob_id', 'photo_review')
    `));
    _ready = rows.length === 2;
  } catch {
    _ready = false;
  }
  if (!_ready) _lastMiss = Date.now();
  return _ready;
}

/* ───────── 올린 사람 확인표(토큰) ─────────
   사진 번호는 차례대로 매겨져 짐작할 수 있다. 번호만으로 붙일 수 있으면
   남이 막 올린 사진을 자기 편지에 가로채 붙일 수 있으므로,
   올린 사람에게만 확인표를 주고 편지를 보낼 때 함께 내게 한다. */
function secret(): string {
  return process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || "memorial-letter-photo";
}

function macOf(blobId: number, stamp: string): string {
  return createHmac("sha256", secret())
    .update(`memorial-letter-photo|${blobId}|${stamp}`)
    .digest("base64url")
    .slice(0, 32);
}

export function signPhotoToken(blobId: number, issuedAt: number = Date.now()): string {
  const stamp = Math.floor(issuedAt).toString(36);
  return `${stamp}.${macOf(blobId, stamp)}`;
}

export function verifyPhotoToken(blobId: number, token: unknown): boolean {
  if (!Number.isFinite(blobId) || blobId <= 0) return false;
  const m = /^([0-9a-z]{1,12})\.([A-Za-z0-9_-]{32})$/.exec(String(token || ""));
  if (!m) return false;
  const issuedAt = parseInt(m[1], 36);
  const now = Date.now();
  if (!Number.isFinite(issuedAt)) return false;
  if (now - issuedAt > TOKEN_TTL_MS) return false;      // 너무 오래됨
  if (issuedAt - now > 60 * 1000) return false;         // 앞날짜
  const expect = Buffer.from(macOf(blobId, m[1]));
  const given = Buffer.from(m[2]);
  return expect.length === given.length && timingSafeEqual(expect, given);
}

/* ───────── 올린 접속 표시 ─────────
   사진 파일 이름(blob_key) 둘째 칸에 넣어 «같은 접속이 방금 몇 번 올렸는지»를 센다.
   기존 파일 이름 규칙(«용도/올린 사람/시각_난수.확장자»)과 같은 자리다.
   접속 주소를 되돌릴 수 없게 섞은 값(client-ip)을 한 번 더 섞어 앞 16자만 쓴다 —
   다른 표(헌화·편지)의 값과도 이어지지 않는다. */
export function uploaderTag(ipHash: string): string {
  return createHmac("sha256", secret())
    .update(`memorial-letter-photo|uploader|${String(ipHash || "")}`)
    .digest("hex")
    .slice(0, 16);
}

export function photoKeyPrefix(tag: string): string {
  return `${LETTER_PHOTO_CONTEXT}/u${tag}/`;
}

/* ───────── 파일 머리 바이트로 형식 확인 ───────── */
export type SniffedKind = "jpeg" | "png" | "webp" | "gif" | "heic" | "avif" | null;

export function sniffImageKind(b: Uint8Array): SniffedKind {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  const ascii = (s: number, e: number) => String.fromCharCode(...Array.from(b.subarray(s, e)));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "gif";
  /* 아이폰 HEIC·AVIF 는 «ftyp» 상자에 상표가 적혀 있다 (대표 상표 + 호환 상표 목록) */
  if (ascii(4, 8) === "ftyp") {
    const boxSize = (b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]) >>> 0;
    const end = Math.min(b.length, boxSize >= 16 && boxSize <= 512 ? boxSize : 32);
    const brands = [ascii(8, 12)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(i, i + 4));
    const low = brands.map((x) => x.toLowerCase());
    if (low.some((x) => x === "avif" || x === "avis")) return "avif";
    if (low.some((x) => /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/.test(x))) return "heic";
  }
  return null;
}

/* ───────── 남용 방지 집계 ─────────
   실패하면 null — 호출부는 막지 않는다(확인 자체가 실패했다고 정상 참여를 놓치지 않기 위해,
   편지 60초 간격 확인과 같은 원칙). 저장이 실패하면 어차피 올리기도 실패한다. */
export interface PhotoUploadCounts { ipShort: number; ipDay: number; globalHour: number; }

export async function recentPhotoUploads(tag: string): Promise<PhotoUploadCounts | null> {
  try {
    const prefix = photoKeyPrefix(tag) + "%";
    const rows = rowsOf(await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE blob_key LIKE ${prefix} AND created_at > NOW() - INTERVAL '10 minutes')::int AS ip_short,
        COUNT(*) FILTER (WHERE blob_key LIKE ${prefix})::int AS ip_day,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS global_hour
        FROM blob_uploads
       WHERE context = ${LETTER_PHOTO_CONTEXT}
         AND created_at > NOW() - INTERVAL '1 day'
    `));
    const r = rows[0] || {};
    return {
      ipShort: Number(r.ip_short || 0),
      ipDay: Number(r.ip_day || 0),
      globalHour: Number(r.global_hour || 0),
    };
  } catch (e) {
    console.warn("[memorial-letter-photo.recent]", e);
    return null;
  }
}

/** 상한에 걸렸으면 안내 문구, 아니면 null */
export function photoUploadBlockReason(c: PhotoUploadCounts | null): string | null {
  if (!c) return null;
  if (c.ipShort >= PHOTO_UPLOAD_LIMITS.ipShort) {
    return "짧은 시간에 사진을 여러 번 올리셨습니다. 10분쯤 뒤에 다시 붙여 주세요.";
  }
  if (c.ipDay >= PHOTO_UPLOAD_LIMITS.ipDay) {
    return "오늘은 사진을 더 올릴 수 없습니다. 내일 다시 붙여 주세요.";
  }
  if (c.globalHour >= PHOTO_UPLOAD_LIMITS.globalHour) {
    return "지금 사진을 올리는 분이 많습니다. 잠시 뒤에 다시 붙여 주세요.";
  }
  return null;
}

/* ───────── 편지에 붙이기 ───────── */

/** 이 경로로 방금(6시간 안) 올라왔고, 아직 어느 편지에도 붙지 않은 사진인지 */
export async function findAttachablePhoto(blobId: number): Promise<boolean> {
  if (!Number.isFinite(blobId) || blobId <= 0) return false;
  const rows = rowsOf(await db.execute(sql`
    SELECT id FROM blob_uploads
     WHERE id = ${blobId}
       AND context = ${LETTER_PHOTO_CONTEXT}
       AND reference_id IS NULL
       AND upload_status = 'completed'
       AND created_at > NOW() - (${ATTACH_WINDOW_HOURS} * INTERVAL '1 hour')
     LIMIT 1
  `));
  return rows.length > 0;
}

export interface NewPhotoLetter {
  teacherId: number;
  memberId: number | null;
  authorName: string;
  title: string | null;
  content: string;
  isAnonymous: boolean;
  isHidden: boolean;
  photoBlobId: number;
}

/** 사진이 붙은 편지 저장 — 처음부터 «사진 검토 대기»로 한 번에 넣는다.
 *  (먼저 넣고 나중에 표시를 바꾸면 그 사이 잠깐 공개 목록에 보일 수 있다) */
export async function insertLetterWithPhoto(p: NewPhotoLetter): Promise<{
  id: number; authorName: string; title: string | null; content: string; createdAt: any;
}> {
  const rows = rowsOf(await db.execute(sql`
    INSERT INTO memorial_letters
      (teacher_id, member_id, author_name, title, content, is_anonymous, is_hidden, photo_blob_id, photo_review)
    VALUES
      (${p.teacherId}, ${p.memberId}, ${p.authorName}, ${p.title}, ${p.content},
       ${p.isAnonymous}, ${p.isHidden}, ${p.photoBlobId}, 'pending')
    RETURNING id, author_name, title, content, created_at
  `));
  const r = rows[0];
  if (!r) throw new Error("편지 저장 결과를 읽지 못했습니다");
  return {
    id: Number(r.id),
    authorName: r.author_name,
    title: r.title ?? null,
    content: r.content,
    createdAt: r.created_at,
  };
}

/** 사진을 이 편지 몫으로 묶는다(다른 편지에 다시 붙지 않게) + 고아 정리 표시(만료일)를 지운다 */
export async function claimLetterPhoto(blobId: number, letterId: number): Promise<boolean> {
  try {
    const rows = rowsOf(await db.execute(sql`
      UPDATE blob_uploads
         SET reference_table = 'memorial_letters', reference_id = ${letterId}, expires_at = NULL
       WHERE id = ${blobId} AND context = ${LETTER_PHOTO_CONTEXT} AND reference_id IS NULL
      RETURNING id
    `));
    return rows.length > 0;
  } catch (e) {
    console.warn("[memorial-letter-photo.claim]", e);
    return false;
  }
}

/* ───────── 조회 ───────── */

export function photoUrlOf(blobId: number | null | undefined): string | null {
  const n = Number(blobId || 0);
  return n > 0 ? `/api/blob-image?id=${n}` : null;
}

/** 편지 id 목록의 사진 상태 (관리자 목록 표시용). 준비 전·실패면 빈 객체 */
export async function letterPhotoInfo(ids: number[]): Promise<Record<number, { photoBlobId: number | null; photoReview: string | null }>> {
  const out: Record<number, { photoBlobId: number | null; photoReview: string | null }> = {};
  const list = Array.from(new Set(ids.filter((n) => Number.isFinite(n) && n > 0)));
  if (!list.length || !(await letterPhotoReady())) return out;
  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT id, photo_blob_id, photo_review FROM memorial_letters
       WHERE photo_blob_id IS NOT NULL
         AND id IN (${sql.join(list.map((id) => sql`${id}`), sql`, `)})
    `));
    for (const r of rows) {
      out[Number(r.id)] = {
        photoBlobId: r.photo_blob_id != null ? Number(r.photo_blob_id) : null,
        photoReview: r.photo_review ?? null,
      };
    }
  } catch (e) {
    console.warn("[memorial-letter-photo.info]", e);
  }
  return out;
}

/** 운영자 화면 «사진 편지 검토 대기» 목록 (오래된 것부터) */
export async function pendingPhotoLetters(limit = 200): Promise<any[]> {
  const n = Math.max(1, Math.min(500, Math.floor(limit)));
  return rowsOf(await db.execute(sql`
    SELECT id, teacher_id, member_id, author_name, title, content,
           is_hidden, report_count, created_at, photo_blob_id
      FROM memorial_letters
     WHERE photo_review = 'pending'
     ORDER BY created_at ASC
     LIMIT ${n}
  `));
}

/* ───────── 공개 여부 맞추기 ───────── */

/** 편지의 지금 상태에 맞춰 사진 파일의 공개 여부를 맞춘다.
 *  공개 = 사진 승인(approved) AND 편지가 숨김이 아님. 그 밖에는 모두 비공개. 실패해도 throw 안 함. */
export async function syncLetterPhotoVisibility(letterId: number): Promise<void> {
  if (!(await letterPhotoReady())) return;
  try {
    await db.execute(sql`
      UPDATE blob_uploads b
         SET is_public = (l.photo_review = 'approved' AND l.is_hidden = FALSE)
        FROM memorial_letters l
       WHERE l.id = ${letterId}
         AND b.id = l.photo_blob_id
         AND b.context = ${LETTER_PHOTO_CONTEXT}
    `);
  } catch (e) {
    console.warn("[memorial-letter-photo.sync]", e);
  }
}

/** 편지를 지운 뒤 — 그 편지에 묶였던 사진을 비공개로 돌린다.
 *  (묶음 표시는 기존 칸 reference_table·reference_id 라서 마이그 전에도 안전하다) */
export async function hidePhotoOfLetter(letterId: number): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE blob_uploads SET is_public = FALSE
       WHERE context = ${LETTER_PHOTO_CONTEXT}
         AND reference_table = 'memorial_letters'
         AND reference_id = ${letterId}
    `);
  } catch (e) {
    console.warn("[memorial-letter-photo.hideOfLetter]", e);
  }
}

/** 운영자 결정 적용 — 편지 상태와 사진 파일 공개 여부를 한 번에(같은 트랜잭션) 바꾼다.
 *    approve : 사진과 함께 공개 (사진 승인 + 숨김 해제 + 사진 파일 공개)
 *    strip   : 사진 빼고 공개 (사진 거절 + 숨김 해제 + 사진 파일 비공개)
 *    hide    : 숨김 (사진 거절 + 숨김 + 사진 파일 비공개) */
export async function applyPhotoDecision(letterId: number, decision: PhotoDecision): Promise<
  | { ok: true; memberId: number | null; previous: string | null }
  | { ok: false; status: number; error: string }
> {
  const review: PhotoReview = decision === "approve" ? "approved" : "rejected";
  const hidden = decision === "hide";
  const makePublic = decision === "approve";
  return await db.transaction(async (tx) => {
    const rows = rowsOf(await tx.execute(sql`
      SELECT id, member_id, photo_blob_id, photo_review
        FROM memorial_letters WHERE id = ${letterId}
       FOR UPDATE
    `));
    const r = rows[0];
    if (!r) return { ok: false as const, status: 404, error: "대상 편지를 찾을 수 없습니다" };
    if (r.photo_blob_id == null) return { ok: false as const, status: 400, error: "사진이 붙은 편지가 아닙니다" };
    await tx.execute(sql`
      UPDATE memorial_letters SET photo_review = ${review}, is_hidden = ${hidden}
       WHERE id = ${letterId}
    `);
    await tx.execute(sql`
      UPDATE blob_uploads SET is_public = ${makePublic}
       WHERE id = ${Number(r.photo_blob_id)} AND context = ${LETTER_PHOTO_CONTEXT}
    `);
    return {
      ok: true as const,
      memberId: r.member_id != null ? Number(r.member_id) : null,
      previous: r.photo_review ?? null,
    };
  });
}
