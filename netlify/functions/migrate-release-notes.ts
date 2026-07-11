// netlify/functions/migrate-release-notes.ts
// [A안·업데이트 소식] 1회용 마이그레이션 — release_notes 테이블 생성
//   호출: 어드민 로그인 상태에서 https://tbfa.co.kr/api/migrate-release-notes?run=1
//   GET(기본): 진단(인증 불필요) / GET ?run=1: requireAdmin 후 실행. 성공 후 파일 삭제.
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-release-notes" };

function json(status: number, body: any) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  // 진단 — 테이블 존재 여부
  let exists = false;
  try {
    const r: any = await db.execute(sql`SELECT to_regclass('public.release_notes') AS t`);
    exists = !!((r?.rows ?? r ?? [])[0]?.t);
  } catch (e: any) {
    return json(500, { ok: false, step: "diagnose", detail: String(e?.message || e) });
  }

  if (!run) {
    return json(200, { ok: true, mode: "diagnostic", tableExists: exists, hint: exists ? "이미 존재 — 실행 불필요" : "?run=1 로 생성" });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS release_notes (
        id            SERIAL PRIMARY KEY,
        draft_key     VARCHAR(60),
        title         VARCHAR(200) NOT NULL,
        items         JSONB NOT NULL DEFAULT '[]'::jsonb,
        audience      VARCHAR(20) NOT NULL DEFAULT 'operator',
        status        VARCHAR(20) NOT NULL DEFAULT 'draft',
        published_at  TIMESTAMP,
        created_by    INTEGER,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS release_notes_status_idx ON release_notes (status)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS release_notes_draft_key_uq ON release_notes (draft_key)`);
    return json(200, { ok: true, mode: "run", message: "release_notes 테이블 생성 완료", before: exists });
  } catch (e: any) {
    return json(500, { ok: false, step: "create", detail: String(e?.message || e) });
  }
};
