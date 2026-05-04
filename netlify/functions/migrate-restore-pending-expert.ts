// netlify/functions/migrate-restore-pending-expert.ts
// ★ 1회용 마이그레이션 — 실행 후 즉시 삭제 (보안)
//
// 목적: Pass 1-A에서 DROP한 members.pending_expert_review 컬럼 복원
//   - schema.ts에 여전히 정의되어 있어 Drizzle SELECT 시 PostgresError 발생
//   - 로그인/회원조회 등 모든 members 쿼리가 500 에러
//
// 호출:
//   GET /.netlify/functions/migrate-restore-pending-expert?key=siren-restore-2026
//
// ★ 응답 ok:true 확인 후 즉시 이 파일 삭제 + git push

import type { Handler } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

const MIGRATION_KEY = "siren-restore-2026";

export const handler: Handler = async (event) => {
  const key = event.queryStringParameters?.key;
  if (key !== MIGRATION_KEY) {
    return {
      statusCode: 401,
      body: JSON.stringify({ ok: false, error: "Unauthorized" }),
    };
  }

  try {
    /* members.pending_expert_review 컬럼 복원 */
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS pending_expert_review BOOLEAN DEFAULT false
    `);

    /* 검증 */
    const verify: any = await db.execute(sql`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'members' AND column_name = 'pending_expert_review'
    `);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        message: "members.pending_expert_review 컬럼 복원 완료",
        verify: verify.rows || verify || [],
      }, null, 2),
    };
  } catch (e: any) {
    console.error("[migrate-restore-pending-expert]", e);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: e.message,
        stack: e.stack,
      }, null, 2),
    };
  }
};