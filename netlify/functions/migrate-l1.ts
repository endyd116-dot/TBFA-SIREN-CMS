/**
 * GET /api/migrate-l1
 *
 * ★ Phase L 마이그레이션 (키 검증 없음 — 1회용)
 * 1. donations 테이블에 토스 결제 추적 컬럼 4개 추가
 * 2. billing_keys 테이블 생성 (정기 결제용)
 *
 * ⚠️ 보안 경고:
 * - 실행 후 즉시 파일 삭제
 * - IF NOT EXISTS 보호로 중복 실행 안전
 *
 * 사용법:
 * 1. 배포 후 호출: https://tbfa-siren-cms.netlify.app/api/migrate-l1
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
    /* 1. donations 테이블에 토스 컬럼 4개 추가 */
    log.push("[1/8] ALTER donations ADD toss_payment_key...");
    await db.execute(sql`
      ALTER TABLE "donations"
      ADD COLUMN IF NOT EXISTS "toss_payment_key" varchar(200)
    `);
    log.push("    ✅ toss_payment_key 추가");

    log.push("[2/8] ALTER donations ADD toss_order_id...");
    await db.execute(sql`
      ALTER TABLE "donations"
      ADD COLUMN IF NOT EXISTS "toss_order_id" varchar(64)
    `);
    log.push("    ✅ toss_order_id 추가");

    log.push("[3/8] ALTER donations ADD billing_key_id...");
    await db.execute(sql`
      ALTER TABLE "donations"
      ADD COLUMN IF NOT EXISTS "billing_key_id" integer
    `);
    log.push("    ✅ billing_key_id 추가");

    log.push("[4/8] ALTER donations ADD failure_reason...");
    await db.execute(sql`
      ALTER TABLE "donations"
      ADD COLUMN IF NOT EXISTS "failure_reason" varchar(500)
    `);
    log.push("    ✅ failure_reason 추가");

    /* 2. donations 인덱스 추가 */
    log.push("[5/8] CREATE INDEX donations_toss...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "donations_toss_payment_key_idx"
      ON "donations" ("toss_payment_key")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "donations_toss_order_id_idx"
      ON "donations" ("toss_order_id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "donations_billing_key_idx"
      ON "donations" ("billing_key_id")
    `);
    log.push("    ✅ donations 인덱스 3개 생성");

    /* 3. billing_keys 테이블 생성 */
    log.push("[6/8] CREATE TABLE billing_keys...");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "billing_keys" (
        "id" serial PRIMARY KEY,
        "member_id" integer NOT NULL REFERENCES "members"("id") ON DELETE CASCADE,
        "billing_key" varchar(200) NOT NULL UNIQUE,
        "customer_key" varchar(64) NOT NULL UNIQUE,
        "card_company" varchar(30),
        "card_number_masked" varchar(30),
        "card_type" varchar(20),
        "amount" integer NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "next_charge_at" timestamp,
        "last_charged_at" timestamp,
        "consecutive_fail_count" integer DEFAULT 0,
        "last_failure_reason" varchar(500),
        "deactivated_at" timestamp,
        "deactivated_reason" varchar(200),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    log.push("    ✅ billing_keys 테이블 생성");

    /* 4. billing_keys 인덱스 */
    log.push("[7/8] CREATE INDEX billing_keys...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "billing_keys_member_idx"
      ON "billing_keys" ("member_id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "billing_keys_active_idx"
      ON "billing_keys" ("is_active")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "billing_keys_next_charge_idx"
      ON "billing_keys" ("next_charge_at")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "billing_keys_customer_key_idx"
      ON "billing_keys" ("customer_key")
    `);
    log.push("    ✅ billing_keys 인덱스 4개 생성");

    /* 5. 검증 */
    log.push("[8/8] 검증 쿼리 실행...");
    const verifyDonations = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'donations'
        AND column_name IN ('toss_payment_key', 'toss_order_id', 'billing_key_id', 'failure_reason')
      ORDER BY column_name
    `);
    const verifyBillingKeys = await db.execute(sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'billing_keys'
      ORDER BY ordinal_position
    `);

    log.push("");
    log.push("✅ Phase L-1 마이그레이션 완료!");
    log.push("");
    log.push("⚠️ 즉시 다음 작업 수행:");
    log.push("   1. netlify/functions/migrate-l1.ts 파일 삭제");
    log.push("   2. git commit + push");
    log.push("   3. Netlify 환경변수 추가:");
    log.push("      - TOSS_TEST_CLIENT_KEY = test_ck_vZnjEJeQVxeemRee2PBMrPmOoBN0");
    log.push("      - TOSS_TEST_SECRET_KEY = test_sk_DpexMgkW36oW2na5bXNpVGbR5ozO");
    log.push("      - TOSS_MODE = test  (라이브 전환 시 'live'로 변경)");
    log.push("   4. Clear cache and deploy");

    return ok({
      success: true,
      log,
      donationsColumns: (verifyDonations as any).rows || verifyDonations,
      billingKeysColumns: (verifyBillingKeys as any).rows || verifyBillingKeys,
    }, "Phase L-1 마이그레이션 성공 — 즉시 파일을 삭제하세요");
  } catch (err: any) {
    console.error("[migrate-l1]", err);
    log.push(`❌ 오류: ${err?.message || String(err)}`);
    return serverError("마이그레이션 중 오류", {
      log,
      error: err?.message,
    });
  }
};

export const config = { path: "/api/migrate-l1" };