/**
 * ⚠️ 일회용 마이그레이션 함수 - STEP E-1
 * support_requests 테이블에 4개 컬럼 추가
 *
 * 사용 방법:
 *   GET /api/migrate-step-e1?key=siren-migrate-2026-e1
 *
 * ⚠️ 사용 후 반드시 이 파일 삭제!
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { ok, badRequest, serverError, methodNotAllowed } from "../../lib/response";

const MIGRATION_KEY = "siren-migrate-2026-e1";

export default async (req: Request) => {
  if (req.method !== "GET") return methodNotAllowed();

  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== MIGRATION_KEY) {
    return badRequest("Invalid migration key");
  }

  try {
    const results: string[] = [];

    /* 1. 컬럼 4개 추가 */
    await db.execute(sql`
      ALTER TABLE support_requests
        ADD COLUMN IF NOT EXISTS answered_by integer REFERENCES members(id) ON DELETE SET NULL
    `);
    results.push("✅ answered_by column added");

    await db.execute(sql`
      ALTER TABLE support_requests
        ADD COLUMN IF NOT EXISTS answered_at timestamp
    `);
    results.push("✅ answered_at column added");

    await db.execute(sql`
      ALTER TABLE support_requests
        ADD COLUMN IF NOT EXISTS priority varchar(10)
    `);
    results.push("✅ priority column added");

    await db.execute(sql`
      ALTER TABLE support_requests
        ADD COLUMN IF NOT EXISTS priority_reason text
    `);
    results.push("✅ priority_reason column added");

    /* 2. 인덱스 생성 */
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS support_priority_idx
        ON support_requests(priority)
    `);
    results.push("✅ priority index created");

    /* 3. 검증 */
    const verify = await db.execute(sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'support_requests'
        AND column_name IN ('answered_by', 'answered_at', 'priority', 'priority_reason')
      ORDER BY column_name
    `);

    return ok({
      success: true,
      results,
      verification: verify,
      message: "마이그레이션 완료! 이제 이 함수 파일을 삭제하세요.",
    }, "Migration STEP E-1 completed");
  } catch (err: any) {
    console.error("[migrate-step-e1]", err);
    return serverError("마이그레이션 실패", {
      message: err?.message || String(err),
      stack: err?.stack,
    });
  }
};

export const config = { path: "/api/migrate-step-e1" };