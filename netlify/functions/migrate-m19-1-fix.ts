// netlify/functions/migrate-m19-1-fix.ts
// ★ 1회용 마이그레이션 — 실행 후 즉시 삭제 (보안)
//
// 목적:
//   1. M-19-11 V2 STEP 1 마이그레이션 미완료 보정
//      - members에 certificate_*, secondary_* 컬럼 7개 추가
//      - members.pending_expert_review DROP
//      - expert_profiles 테이블 DROP
//      - expert_type / expert_status ENUM DROP
//   2. member_grades 시드 등급 순서 정정
//   3. members.grade_id FK 추가
//
// 호출:
//   GET /api/migrate-m19-1-fix?key=siren-m19-1-fix-2026
//
// ★ 응답 ok:true 확인 후 즉시 이 파일 삭제 + git push

import type { Handler } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

const MIGRATION_KEY = "siren-m19-1-fix-2026";

export const handler: Handler = async (event) => {
  // 키 검증
  const key = event.queryStringParameters?.key;
  if (key !== MIGRATION_KEY) {
    return {
      statusCode: 401,
      body: JSON.stringify({ ok: false, error: "Unauthorized" }),
    };
  }

  const log: string[] = [];

  try {
    /* =====================================================
       STEP 1. M-19-11 V2: members에 신규 컬럼 7개 추가
       ===================================================== */
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS certificate_blob_id INTEGER,
        ADD COLUMN IF NOT EXISTS certificate_verified_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS certificate_rejected_reason TEXT,
        ADD COLUMN IF NOT EXISTS certificate_uploaded_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS secondary_verified BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS secondary_verified_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS secondary_verified_by INTEGER
    `);
    log.push("✅ members에 M-19-11 V2 컬럼 7개 추가 완료");

    /* =====================================================
       STEP 2. members.pending_expert_review 컬럼 DROP
       ===================================================== */
    await db.execute(sql`
      ALTER TABLE members DROP COLUMN IF EXISTS pending_expert_review
    `);
    log.push("✅ members.pending_expert_review DROP 완료");

    /* =====================================================
       STEP 3. expert_profiles 테이블 DROP
       ===================================================== */
    await db.execute(sql`DROP TABLE IF EXISTS expert_profiles CASCADE`);
    log.push("✅ expert_profiles 테이블 DROP 완료");

    /* =====================================================
       STEP 4. expert_type / expert_status ENUM DROP
       ===================================================== */
    await db.execute(sql`DROP TYPE IF EXISTS expert_type CASCADE`);
    await db.execute(sql`DROP TYPE IF EXISTS expert_status CASCADE`);
    log.push("✅ expert ENUM 2종 DROP 완료");

    /* =====================================================
       STEP 5. member_grades 시드 5건 재정렬
       (등급 순서 + 기준금액 + 기간 정상화)
       ===================================================== */
    // 1단계: 동행
    await db.execute(sql`
      UPDATE member_grades
      SET name_ko = '동행',
          icon = '🤝',
          color_hex = '#94A3B8',
          min_total_amount = 0,
          min_regular_months = 0,
          sort_order = 1,
          description = 'SIREN과 함께 첫걸음을 내디딘 동반자입니다',
          updated_at = NOW()
      WHERE code = 'companion'
    `);

    // 2단계: 등불
    await db.execute(sql`
      UPDATE member_grades
      SET name_ko = '등불',
          icon = '🕯️',
          color_hex = '#FBBF24',
          min_total_amount = 100000,
          min_regular_months = 0,
          sort_order = 2,
          description = '어둠 속에서 길을 비추는 따뜻한 빛입니다',
          updated_at = NOW()
      WHERE code = 'beacon'
    `);

    // 3단계: 든든
    await db.execute(sql`
      UPDATE member_grades
      SET name_ko = '든든',
          icon = '🌳',
          color_hex = '#10B981',
          min_total_amount = 500000,
          min_regular_months = 6,
          sort_order = 3,
          description = '꾸준한 후원으로 든든한 버팀목이 되어주십니다',
          updated_at = NOW()
      WHERE code = 'steadfast'
    `);

    // 4단계: 디딤돌
    await db.execute(sql`
      UPDATE member_grades
      SET name_ko = '디딤돌',
          icon = '🪨',
          color_hex = '#3B82F6',
          min_total_amount = 1000000,
          min_regular_months = 12,
          sort_order = 4,
          description = '유가족이 다시 일어설 수 있는 디딤돌입니다',
          updated_at = NOW()
      WHERE code = 'stepping_stone'
    `);

    // 5단계: 기둥
    await db.execute(sql`
      UPDATE member_grades
      SET name_ko = '기둥',
          icon = '🏛️',
          color_hex = '#7C3AED',
          min_total_amount = 3000000,
          min_regular_months = 24,
          sort_order = 5,
          description = 'SIREN을 떠받치는 가장 든든한 기둥입니다',
          updated_at = NOW()
      WHERE code = 'pillar'
    `);
    log.push("✅ member_grades 5건 시드 재정렬 완료");

    /* =====================================================
       STEP 6. members.grade_id FK 추가
       (이미 있으면 스킵)
       ===================================================== */
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'members_grade_id_fkey'
        ) THEN
          ALTER TABLE members
            ADD CONSTRAINT members_grade_id_fkey
            FOREIGN KEY (grade_id)
            REFERENCES member_grades(id)
            ON DELETE SET NULL;
        END IF;
      END $$
    `);
    log.push("✅ members.grade_id FK 추가 완료");

    /* =====================================================
       STEP 7. 검증 — 결과 조회
       ===================================================== */
    const verifyColumns = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'members'
        AND column_name IN (
          'certificate_blob_id','certificate_verified_at',
          'certificate_rejected_reason','certificate_uploaded_at',
          'secondary_verified','secondary_verified_at','secondary_verified_by',
          'pending_expert_review'
        )
      ORDER BY column_name
    `);

    const verifyGrades = await db.execute(sql`
      SELECT id, code, name_ko, icon, min_total_amount, min_regular_months, sort_order
      FROM member_grades
      ORDER BY sort_order
    `);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        log,
        verify: {
          memberColumns: verifyColumns,
          grades: verifyGrades,
        },
      }, null, 2),
    };
  } catch (e: any) {
    log.push(`❌ 에러: ${e.message}`);
    console.error("[migrate-m19-1-fix] error:", e);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: e.message,
        stack: e.stack,
        log,
      }, null, 2),
    };
  }
};