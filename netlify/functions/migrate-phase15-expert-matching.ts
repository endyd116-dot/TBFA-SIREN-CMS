/**
 * GET /api/migrate-phase15-expert-matching
 * Phase 15: 전문가 매칭 고도화 — 신규 테이블 2개 생성
 *
 * ?run=1 : requireAdmin 후 실행
 * (기본) : 진단 모드
 */
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-phase15-expert-matching" };

export default async (req: Request) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    return new Response(
      JSON.stringify({
        ok: true,
        mode: "진단",
        message: "?run=1 파라미터 추가 후 어드민 로그인 상태에서 호출하면 마이그레이션이 실행됩니다.",
        tables: ["expert_profiles", "matching_feedbacks"],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  try {
    // expert_profiles 테이블 생성
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS expert_profiles (
        id SERIAL PRIMARY KEY,
        member_id INTEGER NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
        specialties TEXT,
        languages TEXT,
        available_days VARCHAR(50),
        available_hours VARCHAR(50),
        region_coverage VARCHAR(100),
        bio TEXT,
        avg_rating NUMERIC(3,2) DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        is_accepting_case BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // matching_feedbacks 테이블 생성
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS matching_feedbacks (
        id SERIAL PRIMARY KEY,
        match_id INTEGER NOT NULL UNIQUE REFERENCES expert_matches(id) ON DELETE CASCADE,
        member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        rating INTEGER NOT NULL,
        comment TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Phase 15 마이그레이션 완료: expert_profiles, matching_feedbacks 테이블 생성",
        tables: ["expert_profiles", "matching_feedbacks"],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "마이그레이션 실패",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
