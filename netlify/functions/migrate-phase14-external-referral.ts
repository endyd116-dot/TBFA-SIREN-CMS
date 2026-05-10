/**
 * GET /api/migrate-phase14-external-referral          — 진단 (인증 불필요)
 * GET /api/migrate-phase14-external-referral?run=1    — 실행 (어드민 세션 필요)
 *
 * 생성 테이블:
 *   external_agencies  — 외부 기관 정보
 *   referral_logs      — 기관 인계 이력
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-phase14-external-referral" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    return new Response(
      JSON.stringify({
        ok: true,
        mode: "diagnostic",
        tables: ["external_agencies", "referral_logs"],
        note: "?run=1 로 어드민 로그인 후 호출하면 실행합니다",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  /* 어드민 인증 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const results: string[] = [];

  try {
    /* ── external_agencies ── */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS external_agencies (
        id               SERIAL PRIMARY KEY,
        name             VARCHAR(200) NOT NULL,
        agency_type      VARCHAR(50)  NOT NULL,
        contact_name     VARCHAR(100),
        contact_phone    VARCHAR(50),
        contact_email    VARCHAR(200),
        jurisdiction     VARCHAR(200),
        template_body    TEXT,
        is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
        created_by       INTEGER      REFERENCES members(id) ON DELETE SET NULL,
        created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);
    results.push("external_agencies 테이블 생성(또는 이미 존재)");

    /* ── referral_logs ── */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS referral_logs (
        id                  SERIAL PRIMARY KEY,
        agency_id           INTEGER      REFERENCES external_agencies(id) ON DELETE SET NULL,
        agency_name         VARCHAR(200) NOT NULL,
        source_type         VARCHAR(20)  NOT NULL,
        source_id           INTEGER,
        source_no           VARCHAR(50),
        referred_by         INTEGER      REFERENCES members(id) ON DELETE SET NULL,
        referred_at         TIMESTAMP    NOT NULL DEFAULT NOW(),
        pdf_storage_key     VARCHAR(500),
        status              VARCHAR(30)  NOT NULL DEFAULT 'pending',
        status_memo         TEXT,
        status_updated_by   INTEGER      REFERENCES members(id) ON DELETE SET NULL,
        status_updated_at   TIMESTAMP,
        created_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);
    results.push("referral_logs 테이블 생성(또는 이미 존재)");

    /* ── 인덱스 ── */
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ea_type_idx   ON external_agencies(agency_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ea_active_idx ON external_agencies(is_active)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS rl_agency_idx ON referral_logs(agency_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS rl_source_idx ON referral_logs(source_type, source_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS rl_status_idx ON referral_logs(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS rl_time_idx   ON referral_logs(referred_at)`);
    results.push("인덱스 생성 완료");

    return new Response(
      JSON.stringify({ ok: true, results }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "마이그레이션 실패",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
        results,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
