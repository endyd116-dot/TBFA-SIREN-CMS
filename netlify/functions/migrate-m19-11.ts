// netlify/functions/migrate-m19-11.ts
// ★ Phase M-19-11: 전문가 회원 시스템
// - expert_profiles 테이블 (전문가 프로필)
// - ENUM: expert_type, expert_status
// - members.pendingExpertReview 플래그
// 호출: GET /api/migrate-m19-11?key=siren-m19-11-2026
// 호출 후 ★ 즉시 삭제 + push

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { ok, badRequest, forbidden, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

const MIGRATION_KEY = "siren-m19-11-2026";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) return badRequest("key 파라미터가 필요합니다");
    if (key !== MIGRATION_KEY) return forbidden("invalid key");

    const results: any = {};

    /* ===== 1. ENUM ===== */
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE expert_type AS ENUM ('lawyer', 'counselor');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE expert_status AS ENUM (
          'pending',     -- 승인 대기
          'approved',    -- 승인 완료 (활성)
          'rejected',    -- 반려
          'suspended',   -- 일시 정지
          'resigned'     -- 자진 사퇴
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    results.step1_enums = "ok";

    /* ===== 2. expert_profiles 테이블 ===== */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS expert_profiles (
        id SERIAL PRIMARY KEY,
        member_id INTEGER REFERENCES members(id) ON DELETE CASCADE NOT NULL UNIQUE,
        expert_type expert_type NOT NULL,
        expert_status expert_status DEFAULT 'pending' NOT NULL,
        specialty VARCHAR(200),
        affiliation VARCHAR(200),
        license_number VARCHAR(100),
        years_of_experience INTEGER DEFAULT 0,
        bio TEXT,
        preferred_area VARCHAR(200),
        available_days JSONB DEFAULT '[]'::jsonb,
        available_hours VARCHAR(100),
        is_matchable BOOLEAN DEFAULT false NOT NULL,
        max_concurrent_cases INTEGER DEFAULT 5,
        certificate_blob_id INTEGER,
        additional_docs JSONB DEFAULT '[]'::jsonb,
        admin_memo TEXT,
        reviewed_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP,
        rejected_reason TEXT,
        approved_at TIMESTAMP,
        total_cases_handled INTEGER DEFAULT 0,
        total_cases_completed INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ep_member_idx ON expert_profiles(member_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ep_type_idx ON expert_profiles(expert_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ep_status_idx ON expert_profiles(expert_status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ep_matchable_idx ON expert_profiles(is_matchable)`);
    results.step2_table = "ok";

    /* ===== 3. members에 pending_expert_review 추가 ===== */
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS pending_expert_review BOOLEAN DEFAULT FALSE
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS members_pending_expert_idx
      ON members(pending_expert_review) WHERE pending_expert_review = TRUE
    `);
    results.step3_members_flag = "ok";

    /* ===== 4. 검증 ===== */
    const verifyRow: any = await db.execute(sql`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='expert_profiles') AS "hasTable",
        (SELECT typname FROM pg_type WHERE typname='expert_type') AS "enumType",
        (SELECT typname FROM pg_type WHERE typname='expert_status') AS "enumStatus",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='members' AND column_name='pending_expert_review'
        ) AS "hasPendingFlag"
    `);
    const v: any = (verifyRow as any).rows ? (verifyRow as any).rows[0] : (verifyRow as any)[0] || {};
    results.verify = {
      hasTable: !!v.hasTable,
      enumTypeExists: !!v.enumType,
      enumStatusExists: !!v.enumStatus,
      hasPendingFlag: !!v.hasPendingFlag,
    };

    return ok({
      migration: "m19-11",
      ...results,
      reminder: "★ 호출 성공 후 즉시 이 파일을 삭제하고 push하세요",
    }, "M-19-11 마이그레이션 완료");
  } catch (err: any) {
    console.error("[migrate-m19-11]", err);
    return serverError("M-19-11 마이그레이션 실패", err?.message || String(err));
  }
};

export const config = { path: "/api/migrate-m19-11" };