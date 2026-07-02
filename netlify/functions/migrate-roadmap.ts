/**
 * GET /api/migrate-roadmap        — 진단 (인증 불필요·readonly)
 * GET /api/migrate-roadmap?run=1  — 실행 (어드민 인증)
 *
 * 사업 로드맵 테이블 2종 생성 (멱등·IF NOT EXISTS):
 *   - roadmap_objectives : 사업 전체 목표
 *   - roadmap_phases     : 목표별 실행 단계
 *
 * 호출 성공 후 즉시 파일 삭제 + commit (§6.8 1회용).
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-roadmap" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    /* ── 진단: 현재 테이블 존재 여부 ── */
    step = "diag_exists";
    const existing: any = await db.execute(sql.raw(`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('roadmap_objectives', 'roadmap_phases')
    `));
    const rows = (existing?.rows ?? existing ?? []).map((r: any) => r.table_name);
    const objExists = rows.includes("roadmap_objectives");
    const phaseExists = rows.includes("roadmap_phases");

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnose",
        tables: { roadmap_objectives: objExists, roadmap_phases: phaseExists },
        hint: (objExists && phaseExists)
          ? "이미 두 테이블 모두 존재. 재실행해도 안전(IF NOT EXISTS)."
          : "?run=1 로 실행하면 누락 테이블 생성.",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    /* ── 목표 테이블 ── */
    step = "create_objectives";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS roadmap_objectives (
        id           SERIAL PRIMARY KEY,
        title        VARCHAR(300) NOT NULL,
        description  TEXT,
        category     VARCHAR(50),
        status       VARCHAR(20) NOT NULL DEFAULT 'active',
        progress     INTEGER NOT NULL DEFAULT 0,
        owner_id     INTEGER REFERENCES members(id) ON DELETE SET NULL,
        owner_name   VARCHAR(100),
        start_date   DATE,
        target_date  DATE,
        color        VARCHAR(20) NOT NULL DEFAULT 'indigo',
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_by   INTEGER REFERENCES members(id) ON DELETE SET NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    step = "index_objectives";
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS roadmap_objectives_status_idx ON roadmap_objectives(status)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS roadmap_objectives_owner_idx ON roadmap_objectives(owner_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS roadmap_objectives_sort_idx ON roadmap_objectives(sort_order)`));

    /* ── 단계 테이블 ── */
    step = "create_phases";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS roadmap_phases (
        id           SERIAL PRIMARY KEY,
        objective_id INTEGER NOT NULL REFERENCES roadmap_objectives(id) ON DELETE CASCADE,
        title        VARCHAR(300) NOT NULL,
        description  TEXT,
        status       VARCHAR(20) NOT NULL DEFAULT 'planned',
        progress     INTEGER NOT NULL DEFAULT 0,
        start_date   DATE NOT NULL,
        end_date     DATE NOT NULL,
        color        VARCHAR(20),
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_by   INTEGER REFERENCES members(id) ON DELETE SET NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    step = "index_phases";
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS roadmap_phases_objective_idx ON roadmap_phases(objective_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS roadmap_phases_range_idx ON roadmap_phases(start_date, end_date)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS roadmap_phases_sort_idx ON roadmap_phases(sort_order)`));

    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      created: {
        roadmap_objectives: !objExists,
        roadmap_phases: !phaseExists,
      },
      hint: "로드맵 테이블 준비 완료. /workspace-roadmap.html 에서 목표·단계를 등록할 수 있습니다. 성공 확인 후 이 파일 삭제 + commit.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
