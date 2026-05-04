// netlify/functions/migrate-m19-1-fix.ts
// ★ 긴급 핫픽스: schema.ts에 정의되었지만 DB에 없는 등급 컬럼 추가
// 호출: GET /api/migrate-m19-1-fix?key=siren-m19-1-fix-2026
// 호출 후 ★즉시 삭제 + push

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { ok, badRequest, forbidden, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) return badRequest("key 필요");
    if (key !== "siren-m19-1-fix-2026") return forbidden("invalid key");

    const results: any = {};

    /* 1. 등급 관련 컬럼 5개 추가 (members 테이블) */
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS grade_id INTEGER,
        ADD COLUMN IF NOT EXISTS grade_assigned_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS grade_locked BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS total_donation_amount INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS regular_months_count INTEGER DEFAULT 0
    `);
    results.step1_gradeColumns = "ok";

    /* 2. 등급 인덱스 */
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS members_grade_idx ON members(grade_id)
    `);
    results.step2_gradeIndex = "ok";

    /* 3. member_grades 테이블 (아직 없으면 생성) */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS member_grades (
        id SERIAL PRIMARY KEY,
        code VARCHAR(30) NOT NULL UNIQUE,
        name_ko VARCHAR(50) NOT NULL,
        min_total_amount INTEGER NOT NULL DEFAULT 0,
        min_regular_months INTEGER NOT NULL DEFAULT 0,
        color VARCHAR(20) NOT NULL,
        icon VARCHAR(10) NOT NULL,
        sort_order INTEGER NOT NULL,
        benefits JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    results.step3_memberGradesTable = "ok";

    /* 4. 등급 시드 데이터 (5단계) */
    await db.execute(sql`
      INSERT INTO member_grades (code, name_ko, min_total_amount, min_regular_months, color, icon, sort_order)
      VALUES
        ('companion', '동행', 0, 0, '#8a8a8a', '🤝', 1),
        ('steadfast', '든든', 100000, 3, '#1a5ec4', '💙', 2),
        ('stepping_stone', '디딤돌', 500000, 6, '#1a8b46', '🌿', 3),
        ('pillar', '기둥', 1000000, 12, '#c47a00', '🏛️', 4),
        ('beacon', '등불', 3000000, 24, '#7a1f2b', '🔥', 5)
      ON CONFLICT (code) DO NOTHING
    `);
    results.step4_gradeSeed = "ok";

    /* 5. churn 컬럼 확인 (이전 마이그레이션에서 이미 추가됐을 수 있음) */
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS churn_risk_score INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS churn_risk_level VARCHAR(20),
        ADD COLUMN IF NOT EXISTS churn_last_evaluated_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS churn_signals JSONB DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS last_reengage_email_at TIMESTAMP
    `);
    results.step5_churnColumns = "ok (or already exist)";

    /* 6. 검증 */
    const verify: any = await db.execute(sql`
      SELECT 
        COUNT(*) AS total_members,
        (SELECT COUNT(*) FROM member_grades) AS total_grades
      FROM members LIMIT 1
    `);
    results.verify = (verify as any)?.rows?.[0] || (verify as any)?.[0] || null;

    return ok({
      migration: "m19-1-fix",
      ...results,
      reminder: "★ 호출 성공 후 즉시 이 파일을 삭제하고 push하세요",
    }, "M-19-1 핫픽스 마이그레이션 완료");
  } catch (err: any) {
    console.error("[migrate-m19-1-fix]", err);
    return serverError("마이그레이션 실패", err?.message || String(err));
  }
};

export const config = { path: "/api/migrate-m19-1-fix" };