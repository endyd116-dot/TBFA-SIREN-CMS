/**
 * GET /api/migrate-memorial-v3        — 진단 (인증 불필요·readonly)
 * GET /api/migrate-memorial-v3?run=1  — 실행 (어드민 인증)
 *
 * ★ 2026-10-07 추모관 v3 (정책국장 요청 반영) 저장소 준비
 *   ① memorial_letters   + publish_consent(출판 동의) · meta(질문·초대 경로·확장용) · ip_hash(비회원 도배 방지)
 *   ② memorial_family_notes + photo_blob_id (근황 사진 — 이미 있으면 그대로)
 *   ③ memorial_timeline  신설 — '우리가 함께 놓은 온기의 징검다리' (협의회가 걸어온 길, 시간순)
 *
 * 실행 전에도 화면·어드민은 멀쩡하다(모든 코드가 칸·표 유무를 확인하고 건너뛴다).
 * 실행 뒤부터 출판 동의 저장·비회원 편지 60초 간격·징검다리 등록이 된다.
 *
 * 멱등: IF NOT EXISTS. 호출 성공 후 즉시 파일 삭제 + commit (CLAUDE.md §6.8).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-memorial-v3" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function rowsOf(r: any): any[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

async function diagnose() {
  const letterCols = rowsOf(await db.execute(sql.raw(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'memorial_letters'
       AND column_name IN ('publish_consent', 'meta', 'ip_hash')
  `))).map((r: any) => r.column_name);
  const noteCols = rowsOf(await db.execute(sql.raw(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'memorial_family_notes'
       AND column_name = 'photo_blob_id'
  `))).map((r: any) => r.column_name);
  const timeline = rowsOf(await db.execute(sql.raw(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'memorial_timeline'
  `)));
  return {
    letters: { publish_consent: letterCols.includes("publish_consent"), meta: letterCols.includes("meta"), ip_hash: letterCols.includes("ip_hash") },
    family_notes: { photo_blob_id: noteCols.length > 0 },
    timeline_table: timeline.length > 0,
  };
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const before = await diagnose();
    const allReady = before.letters.publish_consent && before.letters.meta && before.letters.ip_hash
      && before.family_notes.photo_blob_id && before.timeline_table;

    if (!run) {
      return new Response(jsonKST({
        ok: true, mode: "diagnose",
        ready: allReady,
        current: before,
        hint: allReady
          ? "이미 모두 준비됨. 재실행해도 안전(IF NOT EXISTS)."
          : "?run=1 로 실행하면 편지 출판동의·확장 칸, 근황 사진 칸, 징검다리 표가 준비됩니다.",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    step = "letters";
    await db.execute(sql.raw(`ALTER TABLE memorial_letters ADD COLUMN IF NOT EXISTS publish_consent boolean NOT NULL DEFAULT false`));
    await db.execute(sql.raw(`ALTER TABLE memorial_letters ADD COLUMN IF NOT EXISTS meta jsonb`));
    await db.execute(sql.raw(`ALTER TABLE memorial_letters ADD COLUMN IF NOT EXISTS ip_hash varchar(64)`));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS memorial_letters_anon_idx
        ON memorial_letters (ip_hash, created_at) WHERE member_id IS NULL
    `));

    step = "family_notes";
    await db.execute(sql.raw(`ALTER TABLE memorial_family_notes ADD COLUMN IF NOT EXISTS photo_blob_id integer`));

    step = "timeline";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS memorial_timeline (
        id            serial PRIMARY KEY,
        event_date    date,
        date_label    varchar(40),
        category      varchar(40),
        title         varchar(150) NOT NULL,
        summary       text,
        detail        text,
        image_blob_id integer,
        link_url      varchar(300),
        sort_order    integer NOT NULL DEFAULT 0,
        is_public     boolean NOT NULL DEFAULT true,
        created_by    integer,
        created_at    timestamp NOT NULL DEFAULT now(),
        updated_at    timestamp NOT NULL DEFAULT now()
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS memorial_timeline_pub_idx
        ON memorial_timeline (is_public, sort_order, event_date)
    `));

    step = "verify";
    const after = await diagnose();

    return new Response(jsonKST({
      ok: true, mode: "executed",
      before, after,
      hint: "완료. 선생님 화면의 출판 동의 저장·비회원 편지 60초 간격, 어드민의 온기의 징검다리 등록이 바로 됩니다. 성공 확인 후 이 파일 삭제 + commit.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
