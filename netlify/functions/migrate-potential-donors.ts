/**
 * GET /api/migrate-potential-donors
 *
 * 잠재 후원자(potential_donors) 테이블 생성 마이그레이션.
 * GET ?run=1 : requireAdmin 후 실행
 * GET (기본)  : 진단 모드 (인증 불필요)
 *
 * 호출 후 즉시 파일 삭제 (1회용 보안 원칙)
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-potential-donors" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 */
  if (!run) {
    const tableExists: any = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'potential_donors'
      ) AS exists
    `);
    const exists = (Array.isArray(tableExists) ? tableExists[0] : (tableExists as any).rows?.[0])?.exists;
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnosis",
      table_exists: exists,
      message: exists ? "테이블 이미 존재합니다" : "테이블 없음 — ?run=1로 실행하세요",
    }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  /* 실행 모드 — 관리자 인증 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  try {
    /* potential_donors 테이블 */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS potential_donors (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(50) NOT NULL,
        phone           VARCHAR(20),
        address         VARCHAR(200),
        birthdate       VARCHAR(10),
        event_name      VARCHAR(100),
        participated_at TIMESTAMPTZ,
        entry_path      VARCHAR(100),
        memo            TEXT,
        linked_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        linked_at       TIMESTAMPTZ,
        linked_by       INTEGER REFERENCES members(id) ON DELETE SET NULL,
        created_by      INTEGER REFERENCES members(id) ON DELETE SET NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    /* 인덱스 */
    await db.execute(sql`CREATE INDEX IF NOT EXISTS potential_donors_name_idx         ON potential_donors(name)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS potential_donors_phone_idx        ON potential_donors(phone)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS potential_donors_linked_member_idx ON potential_donors(linked_member_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS potential_donors_event_idx        ON potential_donors(event_name)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS potential_donors_created_idx      ON potential_donors(created_at)`);

    return new Response(JSON.stringify({
      ok: true,
      message: "potential_donors 테이블 및 인덱스 생성 완료",
    }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: "마이그레이션 실패",
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
};
