/**
 * GET /api/migrate-l9
 *
 * ★ Phase L-9 마이그레이션 (키 검증 없음 — 1회용)
 *
 * 변경 내역:
 * 1. donations 테이블에 효성 매칭 컬럼 3개 추가
 *    - hyosung_member_no (integer): 효성 회원번호 (예: 60)
 *    - hyosung_contract_no (varchar 20): 효성 계약번호 (예: '001')
 *    - hyosung_bill_no (varchar 30): 효성 청구번호 (중복 방지)
 * 2. donations 인덱스 2개 추가
 * 3. hyosung_import_logs 테이블 신규 (CSV 업로드 이력)
 *
 * ⚠️ 실행 후 즉시 파일 삭제 + 재배포
 * ⚠️ IF NOT EXISTS 보호로 중복 실행 안전
 *
 * 사용법:
 * 1. 배포 후 호출: https://tbfa-siren-cms.netlify.app/api/migrate-l9
 * 2. 성공 응답 확인 → 즉시 파일 삭제 + 재배포
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import {
  ok, serverError, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const log: string[] = [];

  try {
    /* 1. donations 테이블에 효성 컬럼 3개 추가 */
    log.push("[1/7] ALTER donations ADD hyosung_member_no...");
    await db.execute(sql`
      ALTER TABLE "donations"
      ADD COLUMN IF NOT EXISTS "hyosung_member_no" integer
    `);
    log.push("    ✅ hyosung_member_no 추가");

    log.push("[2/7] ALTER donations ADD hyosung_contract_no...");
    await db.execute(sql`
      ALTER TABLE "donations"
      ADD COLUMN IF NOT EXISTS "hyosung_contract_no" varchar(20)
    `);
    log.push("    ✅ hyosung_contract_no 추가");

    log.push("[3/7] ALTER donations ADD hyosung_bill_no...");
    await db.execute(sql`
      ALTER TABLE "donations"
      ADD COLUMN IF NOT EXISTS "hyosung_bill_no" varchar(30)
    `);
    log.push("    ✅ hyosung_bill_no 추가");

    /* 2. donations 인덱스 2개 추가 */
    log.push("[4/7] CREATE INDEX donations_hyosung_member_no_idx...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "donations_hyosung_member_no_idx"
      ON "donations" ("hyosung_member_no")
    `);
    log.push("    ✅ hyosung_member_no 인덱스 생성");

    log.push("[5/7] CREATE INDEX donations_hyosung_bill_no_idx...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "donations_hyosung_bill_no_idx"
      ON "donations" ("hyosung_bill_no")
    `);
    log.push("    ✅ hyosung_bill_no 인덱스 생성");

    /* 3. hyosung_import_logs 테이블 생성 */
    log.push("[6/7] CREATE TABLE hyosung_import_logs...");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "hyosung_import_logs" (
        "id" serial PRIMARY KEY,
        "uploaded_by" integer REFERENCES "members"("id") ON DELETE SET NULL,
        "uploaded_by_name" varchar(50),
        "file_name" varchar(255),
        "file_size" integer,
        "total_rows" integer DEFAULT 0,
        "matched_count" integer DEFAULT 0,
        "created_count" integer DEFAULT 0,
        "updated_count" integer DEFAULT 0,
        "skipped_count" integer DEFAULT 0,
        "failed_count" integer DEFAULT 0,
        "detail" text,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    log.push("    ✅ hyosung_import_logs 테이블 생성");

    /* 4. hyosung_import_logs 인덱스 */
    log.push("[7/7] CREATE INDEX hyosung_import_logs...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "hyosung_import_logs_uploaded_by_idx"
      ON "hyosung_import_logs" ("uploaded_by")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "hyosung_import_logs_created_idx"
      ON "hyosung_import_logs" ("created_at")
    `);
    log.push("    ✅ 인덱스 2개 생성");

    /* 5. 검증 — 컬럼/테이블 존재 확인 */
    log.push("");
    log.push("[검증] 스키마 확인 중...");

    const verifyDonations = await db.execute(sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'donations'
        AND column_name IN ('hyosung_member_no', 'hyosung_contract_no', 'hyosung_bill_no')
      ORDER BY column_name
    `);

    const verifyImportLogs = await db.execute(sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'hyosung_import_logs'
      ORDER BY ordinal_position
    `);

    log.push("");
    log.push("✅ Phase L-9 마이그레이션 완료!");
    log.push("");
    log.push("⚠️ 즉시 다음 작업 수행:");
    log.push("   1. netlify/functions/migrate-l9.ts 파일 삭제");
    log.push("   2. git commit + push");
    log.push("   3. Netlify Clear cache and deploy");

    return ok({
      success: true,
      log,
      donationsNewColumns: (verifyDonations as any).rows || verifyDonations,
      hyosungImportLogsColumns: (verifyImportLogs as any).rows || verifyImportLogs,
    }, "Phase L-9 마이그레이션 성공 — 즉시 파일을 삭제하세요");
  } catch (err: any) {
    console.error("[migrate-l9]", err);
    log.push(`❌ 오류: ${err?.message || String(err)}`);
    return serverError("마이그레이션 중 오류", {
      log,
      error: err?.message,
    });
  }
};

export const config = { path: "/api/migrate-l9" };