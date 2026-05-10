import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-phase20-favorites" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const url = new URL(req.url);
  const run = url.searchParams.get("run");

  // 진단 모드 (인증 불필요)
  if (!run) {
    let adminFavExists = false;
    let adminRecentExists = false;
    try {
      const r: any = await db.execute(sql`
        SELECT
          EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_favorites') AS fav,
          EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_recent_views') AS rv
      `);
      const row = (r.rows ?? r)[0] ?? {};
      adminFavExists   = row.fav   === true || row.fav   === "true";
      adminRecentExists = row.rv   === true || row.rv    === "true";
    } catch (_) {}

    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnose",
      tables: { admin_favorites: adminFavExists, admin_recent_views: adminRecentExists },
      hint: "?run=1 로 호출하면 마이그레이션 실행 (어드민 로그인 필요)",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // 실행 모드 — 어드민 인증 필수
  const auth: any = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const steps: string[] = [];
  const errors: string[] = [];

  // admin_favorites 테이블 생성
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_favorites (
        id         SERIAL PRIMARY KEY,
        member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        menu_key   VARCHAR(100) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    steps.push("admin_favorites 테이블 생성 (IF NOT EXISTS)");
  } catch (err: any) {
    errors.push("admin_favorites 생성 실패: " + String(err?.message || err).slice(0, 300));
  }

  // admin_favorites 인덱스
  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS admin_favorites_member_idx
        ON admin_favorites(member_id)
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS admin_favorites_unique
        ON admin_favorites(member_id, menu_key)
    `);
    steps.push("admin_favorites 인덱스 생성");
  } catch (err: any) {
    errors.push("admin_favorites 인덱스 실패: " + String(err?.message || err).slice(0, 300));
  }

  // admin_recent_views 테이블 생성
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_recent_views (
        id         SERIAL PRIMARY KEY,
        member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        menu_key   VARCHAR(100) NOT NULL,
        viewed_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        count      INTEGER NOT NULL DEFAULT 1
      )
    `);
    steps.push("admin_recent_views 테이블 생성 (IF NOT EXISTS)");
  } catch (err: any) {
    errors.push("admin_recent_views 생성 실패: " + String(err?.message || err).slice(0, 300));
  }

  // admin_recent_views 인덱스
  try {
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS admin_recent_views_unique
        ON admin_recent_views(member_id, menu_key)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS admin_recent_views_member_idx
        ON admin_recent_views(member_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS admin_recent_views_viewed_at_idx
        ON admin_recent_views(viewed_at)
    `);
    steps.push("admin_recent_views 인덱스 생성");
  } catch (err: any) {
    errors.push("admin_recent_views 인덱스 실패: " + String(err?.message || err).slice(0, 300));
  }

  const success = errors.length === 0;
  return new Response(JSON.stringify({
    ok: success,
    steps,
    errors,
    message: success
      ? "Phase 20 마이그레이션 완료 — admin_favorites + admin_recent_views 생성됨"
      : "일부 단계 실패 — errors 확인",
  }), {
    status: success ? 200 : 207,
    headers: { "Content-Type": "application/json" },
  });
}
