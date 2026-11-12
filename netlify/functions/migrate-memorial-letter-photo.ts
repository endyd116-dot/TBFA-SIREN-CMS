/**
 * GET /api/migrate-memorial-letter-photo        — 진단 (인증 불필요·읽기만)
 * GET /api/migrate-memorial-letter-photo?run=1  — 실행 (어드민 인증)
 *
 * ★ 2026-11-12 기억의 편지 사진 첨부 (Swain 결정: 누구나 사진 한 장 · 사진 편지는 운영자 확인 뒤 공개)
 *   memorial_letters
 *     + photo_blob_id integer      — 붙인 사진(blob_uploads.id). 사진이 없으면 null
 *     + photo_review  varchar(16)  — 사진 검토 상태: pending(확인 대기) | approved(사진과 함께 공개) | rejected(사진 뺌)
 *                                    사진이 없으면 null. 숨김(is_hidden)과는 따로 움직인다.
 *     + 부분 색인 memorial_letters_photo_review_idx (photo_review, created_at) — 사진 편지만
 *
 * 실행 전에도 화면·어드민은 멀쩡하다(모든 코드가 칸 유무를 확인하고 «사진 없는 편지»처럼 동작).
 * 실행 뒤 약 30초 안에 선생님 화면의 «사진 1장 붙이기»와 어드민의 «사진 편지 검토 대기»가 켜진다.
 *
 * 멱등: IF NOT EXISTS. 호출 성공 후 즉시 이 파일 삭제 + commit (CLAUDE.md §6.8).
 * 적용 뒤 db/schema.ts memorialLetters 에 photoBlobId·photoReview 정의를 더한다(§9.2 5단계).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-memorial-letter-photo" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function rowsOf(r: any): any[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

async function diagnose() {
  const cols = rowsOf(await db.execute(sql.raw(`
    SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'memorial_letters'
       AND column_name IN ('photo_blob_id', 'photo_review')
  `)));
  const idx = rowsOf(await db.execute(sql.raw(`
    SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'memorial_letters'
       AND indexname = 'memorial_letters_photo_review_idx'
  `)));
  const byName: Record<string, any> = {};
  for (const c of cols) byName[c.column_name] = c;
  return {
    photo_blob_id: byName.photo_blob_id ? { exists: true, type: byName.photo_blob_id.data_type } : { exists: false },
    photo_review: byName.photo_review
      ? { exists: true, type: byName.photo_review.data_type, length: byName.photo_review.character_maximum_length }
      : { exists: false },
    photo_review_index: idx.length > 0,
  };
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const before = await diagnose();
    const allReady = before.photo_blob_id.exists && before.photo_review.exists && before.photo_review_index;

    if (!run) {
      return new Response(jsonKST({
        ok: true, mode: "diagnose",
        ready: allReady,
        current: before,
        hint: allReady
          ? "이미 모두 준비됨. 다시 실행해도 안전(IF NOT EXISTS)."
          : "?run=1 로 실행하면 기억의 편지에 사진 칸(photo_blob_id)과 사진 검토 상태 칸(photo_review)이 준비됩니다.",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;

    step = "columns";
    await db.execute(sql.raw(`ALTER TABLE memorial_letters ADD COLUMN IF NOT EXISTS photo_blob_id integer`));
    await db.execute(sql.raw(`ALTER TABLE memorial_letters ADD COLUMN IF NOT EXISTS photo_review varchar(16)`));

    step = "index";
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS memorial_letters_photo_review_idx
        ON memorial_letters (photo_review, created_at) WHERE photo_review IS NOT NULL
    `));

    step = "verify";
    const after = await diagnose();

    return new Response(jsonKST({
      ok: true, mode: "executed",
      before, after,
      hint: "완료. 약 30초 안에 선생님 화면의 «사진 1장 붙이기»와 어드민 «사진 편지 검토 대기»가 켜집니다. 성공 확인 후 이 파일 삭제 + commit, db/schema.ts에 칸 정의 추가.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
