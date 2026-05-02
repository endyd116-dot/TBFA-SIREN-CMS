/**
 * GET /api/migrate-k2
 *
 * ★ K-2 마이그레이션 (키 검증 없음 — 1회용)
 * 1. members 테이블에 withdrawn_at, withdrawn_reason 컬럼 추가
 * 2. email_verification_tokens 테이블 생성
 *
 * ⚠️ 보안 경고:
 * - 이 파일은 누구나 호출 가능합니다
 * - 반드시 실행 직후 즉시 파일을 삭제하세요
 * - IF NOT EXISTS로 보호되어 있어 여러 번 호출되어도 안전하지만,
 *   파일을 남겨두면 공격자가 DB 구조를 추측하는 단서가 될 수 있습니다
 *
 * 사용법:
 * 1. 배포 후 브라우저에서 호출:
 *    https://your-site.netlify.app/api/migrate-k2
 * 2. 성공 응답 확인 → 즉시 이 파일 삭제 + 재배포
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
    /* 1. members 테이블에 탈퇴 컬럼 추가 */
    log.push("[1/5] ALTER TABLE members ADD withdrawn_at...");
    await db.execute(sql`
      ALTER TABLE "members"
      ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamp
    `);
    log.push("    ✅ withdrawn_at 컬럼 추가 완료");

    log.push("[2/5] ALTER TABLE members ADD withdrawn_reason...");
    await db.execute(sql`
      ALTER TABLE "members"
      ADD COLUMN IF NOT EXISTS "withdrawn_reason" varchar(500)
    `);
    log.push("    ✅ withdrawn_reason 컬럼 추가 완료");

    /* 2. email_verification_tokens 테이블 생성 */
    log.push("[3/5] CREATE TABLE email_verification_tokens...");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
        "id" serial PRIMARY KEY,
        "member_id" integer NOT NULL REFERENCES "members"("id") ON DELETE CASCADE,
        "token_hash" varchar(255) NOT NULL UNIQUE,
        "email" varchar(100) NOT NULL,
        "expires_at" timestamp NOT NULL,
        "used_at" timestamp,
        "ip_address" varchar(45),
        "user_agent" varchar(500),
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    log.push("    ✅ 테이블 생성 완료");

    /* 3. 인덱스 생성 */
    log.push("[4/5] CREATE INDEX evt_member_idx, evt_token_idx, evt_expires_idx...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "evt_member_idx"
      ON "email_verification_tokens" ("member_id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "evt_token_idx"
      ON "email_verification_tokens" ("token_hash")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "evt_expires_idx"
      ON "email_verification_tokens" ("expires_at")
    `);
    log.push("    ✅ 인덱스 3개 생성 완료");

    /* 4. 검증 — 컬럼/테이블 존재 확인 */
    log.push("[5/5] 검증 쿼리 실행...");
    const verifyMembers = await db.execute(sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'members'
        AND column_name IN ('withdrawn_at', 'withdrawn_reason')
      ORDER BY column_name
    `);
    const verifyTokens = await db.execute(sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'email_verification_tokens'
      ORDER BY ordinal_position
    `);

    log.push("");
    log.push("✅ K-2 마이그레이션 완료!");
    log.push("");
    log.push("⚠️ 즉시 다음 작업을 수행하세요:");
    log.push("   1. netlify/functions/migrate-k2.ts 파일 삭제");
    log.push("   2. git commit + push");
    log.push("   3. Netlify 재배포");

    return ok({
      success: true,
      log,
      membersColumns: (verifyMembers as any).rows || verifyMembers,
      tokensColumns: (verifyTokens as any).rows || verifyTokens,
    }, "K-2 마이그레이션 성공 — 즉시 파일을 삭제하세요");
  } catch (err: any) {
    console.error("[migrate-k2]", err);
    log.push(`❌ 오류: ${err?.message || String(err)}`);
    return serverError("마이그레이션 중 오류가 발생했습니다", {
      log,
      error: err?.message,
    });
  }
};

export const config = { path: "/api/migrate-k2" };