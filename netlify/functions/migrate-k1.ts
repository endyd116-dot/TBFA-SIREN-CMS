/**
 * GET /api/migrate-k1?key=YOUR_SECRET
 *
 * ★ K-1 마이그레이션: password_reset_tokens 테이블 생성
 *
 * 사용법:
 * 1. Netlify 환경변수에 MIGRATE_SECRET 설정 (예: "abc123xyz")
 * 2. 배포 후 브라우저에서 호출:
 *    https://your-site.netlify.app/api/migrate-k1?key=abc123xyz
 * 3. 성공 응답 확인 → 즉시 이 파일 삭제 + 환경변수 삭제
 *
 * 안전 장치:
 * - IF NOT EXISTS 사용 → 이미 테이블 있으면 무시
 * - 시크릿 키 검증
 * - 결과 응답에 작업 내역 표시
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import {
  ok, unauthorized, serverError, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  /* 1. 시크릿 키 검증 */
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  const expected = process.env.MIGRATE_SECRET || "";

  if (!expected) {
    return unauthorized(
      "MIGRATE_SECRET 환경변수가 설정되지 않았습니다. Netlify 대시보드에서 설정해 주세요."
    );
  }
  if (key !== expected) {
    return unauthorized("유효하지 않은 마이그레이션 키");
  }

  const log: string[] = [];

  try {
    /* 2. 테이블 생성 */
    log.push("[1/4] CREATE TABLE password_reset_tokens...");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
        "id" serial PRIMARY KEY,
        "member_id" integer NOT NULL REFERENCES "members"("id") ON DELETE CASCADE,
        "token_hash" varchar(255) NOT NULL UNIQUE,
        "expires_at" timestamp NOT NULL,
        "used_at" timestamp,
        "ip_address" varchar(45),
        "user_agent" varchar(500),
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    log.push("    ✅ 테이블 생성 완료");

    /* 3. 인덱스 생성 */
    log.push("[2/4] CREATE INDEX prt_member_idx...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "prt_member_idx"
      ON "password_reset_tokens" ("member_id")
    `);
    log.push("    ✅ member_id 인덱스 생성 완료");

    log.push("[3/4] CREATE INDEX prt_token_idx...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "prt_token_idx"
      ON "password_reset_tokens" ("token_hash")
    `);
    log.push("    ✅ token_hash 인덱스 생성 완료");

    log.push("[4/4] CREATE INDEX prt_expires_idx...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "prt_expires_idx"
      ON "password_reset_tokens" ("expires_at")
    `);
    log.push("    ✅ expires_at 인덱스 생성 완료");

    /* 4. 검증 — 테이블 존재 확인 */
    const verify = await db.execute(sql`
      SELECT
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE table_name = 'password_reset_tokens'
      ORDER BY ordinal_position
    `);

    log.push("");
    log.push("✅ 마이그레이션 완료!");
    log.push("");
    log.push("⚠️ 이제 다음 작업을 즉시 수행하세요:");
    log.push("   1. netlify/functions/migrate-k1.ts 파일 삭제");
    log.push("   2. Netlify 환경변수에서 MIGRATE_SECRET 삭제");
    log.push("   3. 다시 배포");

    return ok({
      success: true,
      log,
      tableColumns: verify.rows || verify,
    }, "마이그레이션 성공 — 즉시 파일을 삭제하세요");
  } catch (err: any) {
    console.error("[migrate-k1]", err);
    log.push(`❌ 오류: ${err?.message || String(err)}`);
    return serverError("마이그레이션 중 오류가 발생했습니다", {
      log,
      error: err?.message,
    });
  }
};

export const config = { path: "/api/migrate-k1" };