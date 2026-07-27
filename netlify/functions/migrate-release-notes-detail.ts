/**
 * GET /api/migrate-release-notes-detail        — 진단 (인증 불필요)
 * GET /api/migrate-release-notes-detail?run=1   — 실행 (슈퍼어드민)
 *
 * 업데이트 소식에 '상세 본문' 기능 추가:
 *   release_notes.body(text)            — 자세한 내용·소개 (마크다운 허용)
 *   release_notes.hero_image_url(varchar) — 대표 이미지 URL (선택)
 *
 * 멱등: ADD COLUMN IF NOT EXISTS. 호출 성공 후 파일 삭제 + commit (§6.8).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-release-notes-detail" };
const JH = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const chk: any = await db.execute(sql.raw(`
      SELECT
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='release_notes' AND column_name='body') AS has_body,
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='release_notes' AND column_name='hero_image_url') AS has_hero
    `));
    const cur = (chk?.rows ?? chk ?? [])[0] || {};

    if (!run) {
      return new Response(jsonKST({
        ok: true, mode: "diagnose",
        has_body: !!cur.has_body, has_hero_image_url: !!cur.has_hero,
        hint: (cur.has_body && cur.has_hero) ? "이미 적용됨(멱등·재실행 안전)." : "?run=1 로 상세 본문·대표이미지 컬럼을 추가합니다.",
      }, null, 2), { headers: JH });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;
    if ((auth as any).ctx?.member?.role !== "super_admin") {
      return new Response(jsonKST({ ok: false, error: "슈퍼어드민만 실행할 수 있습니다" }), { status: 403, headers: JH });
    }

    step = "alter";
    await db.execute(sql.raw(`ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS body text`));
    await db.execute(sql.raw(`ALTER TABLE release_notes ADD COLUMN IF NOT EXISTS hero_image_url varchar(500)`));

    return new Response(jsonKST({
      ok: true, mode: "executed",
      added: ["release_notes.body", "release_notes.hero_image_url"],
      hint: "성공 확인 후 알려주세요. schema 정의 추가 + 상세 페이지/API/편집 진행 + 이 파일 삭제.",
    }, null, 2), { headers: JH });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 800),
    }), { status: 500, headers: JH });
  }
}
