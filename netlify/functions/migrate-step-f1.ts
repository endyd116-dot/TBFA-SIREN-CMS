/**
 * ⚠️ 일회용 마이그레이션 — STEP F-1
 * members 테이블에 운영자 시스템 컬럼 2개 추가
 *
 * 사용:
 *   GET /api/migrate-step-f1?key=siren-migrate-2026-f1
 *
 * ⚠️ 사용 후 즉시 삭제!
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { ok, badRequest, serverError, methodNotAllowed } from "../../lib/response";

const MIGRATION_KEY = "siren-migrate-2026-f1";

export default async (req: Request) => {
  if (req.method !== "GET") return methodNotAllowed();

  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== MIGRATION_KEY) return badRequest("Invalid migration key");

  try {
    const results: string[] = [];

    /* 1. role 컬럼 추가 (super_admin / operator / 빈값) */
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS role varchar(20)
    `);
    results.push("✅ members.role column added");

    /* 2. 알림 수신 여부 (지원 신청 알림) */
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS notify_on_support boolean DEFAULT false
    `);
    results.push("✅ members.notify_on_support column added");

    /* 3. 운영자 활성 여부 (승급 후 비활성화 가능) */
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS operator_active boolean DEFAULT true
    `);
    results.push("✅ members.operator_active column added");

    /* 4. 인덱스 */
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS members_role_idx ON members(role)
    `);
    results.push("✅ members_role_idx created");

    /* 5. 기존 admin 회원을 super_admin으로 자동 승급 */
    await db.execute(sql`
      UPDATE members
        SET role = 'super_admin', notify_on_support = true
        WHERE type = 'admin' AND role IS NULL
    `);
    results.push("✅ existing admins promoted to super_admin");

    /* 6. 검증 */
    const verify: any = await db.execute(sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'members'
        AND column_name IN ('role', 'notify_on_support', 'operator_active')
      ORDER BY column_name
    `);

    const adminCheck: any = await db.execute(sql`
      SELECT id, name, email, type, role, notify_on_support
      FROM members
      WHERE type = 'admin'
      LIMIT 5
    `);

    return ok({
      success: true,
      results,
      verification: verify,
      admins: adminCheck,
      message: "STEP F-1 마이그레이션 완료! 함수 파일을 삭제하세요.",
    }, "Migration STEP F-1 completed");
  } catch (err: any) {
    console.error("[migrate-step-f1]", err);
    return serverError("마이그레이션 실패", {
      message: err?.message || String(err),
    });
  }
};

export const config = { path: "/api/migrate-step-f1" };