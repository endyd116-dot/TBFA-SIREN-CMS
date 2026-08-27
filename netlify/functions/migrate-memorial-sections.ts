/**
 * 1회용 — 선생님 화면 '자유 구간' 저장소 만들기 (2026-08-28)
 *
 * 운영자가 선생님 화면에 원하는 만큼 구간을 직접 늘릴 수 있게 한다.
 * (제목 + 글 + 사진 한 장, 순서·공개 여부)
 *
 * 진단: GET /api/migrate-memorial-sections
 * 실행: GET /api/migrate-memorial-sections?run=1   (어드민 로그인 상태)
 *
 * 호출 성공 후 이 파일은 지운다.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import type { Context } from "@netlify/functions";

export const config = { path: "/api/migrate-memorial-sections" };

function rowsOf(r: any): any[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

async function diagnose() {
  const t = rowsOf(await db.execute(sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'memorial_teacher_sections'
  `));
  let count = 0;
  if (t.length) {
    const c = rowsOf(await db.execute(sql`SELECT COUNT(*)::int AS n FROM memorial_teacher_sections`));
    count = Number(c[0]?.n ?? 0);
  }
  return { 표존재: t.length > 0, 등록된구간: count };
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  try {
    if (!run) {
      return new Response(JSON.stringify({ ok: true, mode: "진단", ...(await diagnose()) }, null, 2), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    const guard: any = await requireAdmin(req);
    if (!guard.ok) return (guard as { ok: false; res: Response }).res;

    /* 여러 번 불러도 안전하다 */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS memorial_teacher_sections (
        id            SERIAL PRIMARY KEY,
        teacher_id    INTEGER NOT NULL,
        title         VARCHAR(120),
        body          TEXT,
        image_blob_id INTEGER,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        is_public     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS memorial_teacher_sections_teacher_idx
        ON memorial_teacher_sections (teacher_id, is_public, sort_order)
    `);

    return new Response(JSON.stringify({
      ok: true, mode: "실행", message: "선생님 화면 자유 구간 저장소를 만들었습니다",
      ...(await diagnose()),
    }, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "마이그레이션 실패",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, null, 2), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
